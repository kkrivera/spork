# @spork/core — agent context

Domain logic only. No `commander`, no color/output formatting, no `process.exit` —
that all belongs in `packages/cli`. `src/index.ts` is this package's only public
surface; nothing in this repo should import from `src/*` paths directly.

## `src/git`

- `exec.ts`'s `execGit` is the *only* place a subprocess gets spawned. Every
  other function in `src/git` (and everything built on top of it later) must
  call through it rather than importing `node:child_process` itself — that's
  what keeps the rest of the codebase mockable in unit tests.
- `execGit` runs git with prompts **off** unless a caller passes
  `allowPrompts: true` (see `git/auth.ts`). Only thread `allowPrompts`
  through for a caller with a person at a real terminal *and* nothing else
  drawing over it — today that's just `@spork/cli`'s single `repo add`.
  Never turn it on for the MCP server, a batch/live-dashboard command, or
  anything that runs concurrently: several git processes prompting at once
  can't work, and a hidden prompt hangs forever. Auth failures surface as
  `GitAuthError` with next steps; add a new stderr pattern to
  `isAuthFailure` rather than catching auth errors ad hoc elsewhere.
- Worktrees are created on **one local branch per workspace** — the
  workspace's own name, verbatim, shared by every repo added to it — never
  by checking out the requested ref directly, and never slugified (it may
  contain `/`). `addWorktree` (`git/worktree.ts`) checks whether that
  branch already exists in a repo's cache first (`branchExists`) and
  reuses it as-is (continuing its history) when it does, only creating a
  fresh one from the start point when it doesn't — don't "simplify" this
  back to always passing `-b`, that breaks resuming a repo a previous,
  removed workspace of the same name already touched. The one thing this
  can't resolve is the branch being checked out *elsewhere right now* — git
  can only check out a branch in one worktree at a time — which
  `workspace.ts`'s `addRepo` turns into a clear `SporkError`
  (`isWorktreeCollisionError`; `isBranchExistsError` is a defensive
  fallback for a check-then-act race) rather than letting git's own
  failure surface, or trying to work around something it fundamentally
  can't. See
  [docs/plans/0001-worktree-workspace-architecture.md](../../docs/plans/0001-worktree-workspace-architecture.md).

## `src/repo`

`ensureRepoCache` (clone-or-fetch) and any worktree mutation against the same
cache path must be called from inside `withRepoLock` by the caller — `cache.ts`
itself doesn't lock, it just does the filesystem/git work. Don't call
`cloneBare`/`fetchAll` directly outside the lock from orchestration code.

## Index files (manifest/registries) need locking too, via `withFileLock`

`@spork/task-runner` means several `addRepo`/`registerRepoAlias`/etc. calls
now run concurrently against the *same* manifest or registry file
(`workspace create --repo a --repo b ...`, the interactive picker, `repo
scan`). Every function that reads one of these small JSON index files,
mutates it in memory, and writes it back — `workspace.ts`'s
`addRepo`/`removeRepo`/`reconcileWorkspace`, and both `registry.ts` and
`repoRegistry.ts`'s register/unregister/self-heal functions — must wrap
that whole cycle in `util/fileLock.ts`'s `withFileLock(path, fn)`,
**re-reading the file from inside the lock** rather than reusing an
earlier read from before the lock was acquired. Skipping the fresh re-read
defeats the lock entirely: two concurrent callers would each still mutate
their own stale in-memory copy and the second write would silently
overwrite the first one's addition. (This bit a real user: `workspace
create` with several `--repo`s left the manifest and `.code-workspace`
with only one of them, even though every worktree had actually been
created on disk.) `withFileLock` is deliberately separate from
`repo/lock.ts`'s `withRepoLock` — see its own doc comment for why it can't
reuse that one's "pre-create the target, then lock" approach.

## `src/registry`

Two registries, same index-not-source-of-truth pattern: `registry.ts` for
workspaces (name → dir) and `repoRegistry.ts` for repo sources (alias →
source). Neither is allowed to be trusted blindly — every `list*` function
self-heals by checking the thing it points at still exists and persisting the
drop if not. Don't add a third ad-hoc "list of things" file anywhere else;
route it through this pattern instead.

`repo/repos.ts`'s `addRepoSource` is the *only* place that both ensures a
repo is cloned and registers/reuses its alias — don't call `ensureRepoCache`
directly from anywhere that also needs alias behavior (that now includes
`workspace.ts`'s `addRepo`). `removeRepoSource`'s in-use check
(`findRepoUsages`) reads the *workspace* registry and every workspace's
manifest — don't add a force-override to skip it; a worktree still
referencing a deleted cache is a real corruption, not a nuisance to bypass.
`findRepoUsages` does deliberately exclude a `workspace init`-adopted entry
(`kind: 'adopted'`) from that check, though — it was never a worktree of
the cache being deleted, just a plain folder that happened to be
identified by the same `source` at adoption time, so there's no object
store for it to lose. Don't widen the force-override question to cover
this case too; it's a correctness fix (an adopted entry structurally can't
be corrupted this way), not a safety bypass.

**The repo registry is two-tier (local + global), the cache is not.** A
workspace-local alias file (`localRepoRegistryPath`) is just the *same*
`repoRegistry.ts` functions pointed at a different path — never invent a
separate mechanism for "local" data. The one thing that must **not** vary by
scope is the cache-deletion safety check: `findRepoUsages` scans *every*
workspace's manifest regardless of which alias file (local or global)
triggered a removal, because the cache it's guarding is shared no matter
how it's named. If you add a local-scoped removal helper, it must still run
the same global scan before touching the cache — narrowing that check to
"just this workspace" would let deleting a local alias corrupt some other
workspace's worktree.

## `src/workspace`

Every manifest change must regenerate the files derived from it through
`workspaceFiles.ts`'s `writeWorkspaceFiles`, never `writeCodeWorkspace` (or
the agent-instruction writers) directly. That single call is what keeps the
`.code-workspace` file and the root `AGENTS.md`/`CLAUDE.md` in step with
`add-repo`/`remove-repo`/reconcile. Never write outside spork's marker block
in `AGENTS.md`/`CLAUDE.md`: in an `init`ed folder the rest of the file is the
user's (see [docs/plans/0004-workspace-agent-instructions.md](../../docs/plans/0004-workspace-agent-instructions.md)).

`workspace.ts` is the only place the `git`/`repo` layers get combined — keep it
that way rather than having e.g. a CLI command call `addWorktree` directly.
Every function that reads a manifest for anything other than a pure display
purpose should go through `reconcileWorkspace` first (see `addRepo`/`removeRepo`
for the pattern), not call `readManifest` directly — that's what keeps stale
worktrees/folders from causing confusing failures later.

`addRepo` registers its alias **locally to the workspace by default**
(`AddRepoOptions.global` opts into the shared registry instead) — this is
deliberately the opposite of "resolve," which always checks local-then-
global-then-raw regardless of where a new alias would be written. Don't
conflate the two: reading an alias and deciding where a *new* one gets
written are different decisions with different defaults.

A frontend (`@spork/cli`, `@spork/mcp`) that creates or removes a
workspace needs the registry bookkeeping done in the same step every
time — an unregistered workspace is orphaned from `list`/`open`/etc., and
a registration with no workspace behind it is corrupt state. Don't let a
second frontend re-implement that pairing by hand; it belongs here as
`createAndRegisterWorkspace`/`removeAndUnregisterWorkspace`, which both
`@spork/cli` and `@spork/mcp` call. If you add a third frontend (or a new
`@spork/cli` command) that creates/removes a workspace, it should call
these too rather than hand-rolling the create-then-register or
remove-then-unregister sequence again.

`workspace init`'s "adopt an existing folder in place, never touch
branches" requirement needed a real data-model distinction, not a
CLI-level check — see
[docs/plans/0003-workspace-init.md](../../docs/plans/0003-workspace-init.md).
A manifest entry's `kind` (`'worktree'` default, or `'adopted'`) and a
workspace's own `origin` (`'created'` default, or `'initialized'`) are
**independent** — don't collapse them into one flag. `kind` is what
`removeRepo` checks before doing a real `git worktree remove`; `origin` is
what `removeWorkspace` checks before treating the workspace directory
itself as deletable at all. They have to stay independent because nothing
stops `add-repo` from adding a real worktree-backed repo into an
`initialized` workspace later — that entry should still be removed the
normal way even though the directory it lives in is still never deleted.
If you add a third way to populate a workspace, give it its own `kind`
rather than overloading `'adopted'`/`'worktree'` to mean something new.

## Tests

Unit tests only for now — mock `execGit` (or `node:child_process` for
`exec.ts`'s own tests), don't spawn real git processes. See root
[CONTRIBUTING.md](../../CONTRIBUTING.md) for the coverage bar (≥80%) and the
rationale for deferring subprocess-driven integration tests.
