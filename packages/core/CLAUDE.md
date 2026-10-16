# @spork/core — agent context

Domain logic only. No `commander`, no color/output formatting, no `process.exit` —
that all belongs in `packages/cli`. `src/index.ts` is this package's only public
surface; nothing in this repo should import from `src/*` paths directly.

## `src/git`

- `exec.ts`'s `execGit` is the *only* place a subprocess gets spawned. Every
  other function in `src/git` (and everything built on top of it later) must
  call through it rather than importing `node:child_process` itself — that's
  what keeps the rest of the codebase mockable in unit tests.
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

## Tests

Unit tests only for now — mock `execGit` (or `node:child_process` for
`exec.ts`'s own tests), don't spawn real git processes. See root
[CONTRIBUTING.md](../../CONTRIBUTING.md) for the coverage bar (≥80%) and the
rationale for deferring subprocess-driven integration tests.
