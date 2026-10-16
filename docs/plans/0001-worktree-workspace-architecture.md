# 0001 — Worktree workspace architecture

Status: Accepted

## Problem

`spork` lets a user pull several independent, unrelated git repos into one local
**workspace**: a folder holding an isolated `git worktree` checkout of each repo
(at a chosen ref), a generated VS Code `.code-workspace` file so they open as one
multi-root editor session, and a manifest describing the workspace so its layout
is reproducible. This doc records the git-worktree mechanics and package
structure needed to make that work correctly, and the tradeoffs behind them.

## Design

### Shared bare clone, unique local branch per worktree

Each repo source is cloned once, as a `git clone --bare` cache under
`~/.spork/repos/<id>/` — never re-cloned per workspace. Every worktree is created
against that shared cache via:

```
git worktree add -b spork/<workspace-slug>/<folder-slug> <path> <start-point>
```

`git worktree add <ref>` fails if `<ref>` is already checked out anywhere else.
Because the clone is *shared across workspaces*, reusing the requested branch
name directly would collide the moment two workspaces (or two worktrees in one
workspace) touch the same repo+branch — a routine scenario for this product, not
an edge case. Giving every worktree its own spork-owned local branch, derived
from the workspace and folder names, avoids that entirely. The manifest records
both the user's requested ref (what they asked to check out) and the actual local
branch (what git has checked out), so `add-repo --branch <ref>` behaves the way
users expect while the underlying git state stays collision-free.

Ref/folder names are slugified before use in derived branch/folder names (e.g. a
`feature/foo` branch must not produce a nested path).

Clones are full, not shallow — the same cache backs arbitrary future branches
over time, and shallow clones would complicate later fetches. Shallow-clone
support is a possible future optimization, not a v1 concern.

### Reconcile before mutating

Users will, in the ordinary course of things, `rm -rf` a worktree folder or an
entire workspace directory by hand instead of going through `remove-repo`/
`remove`. That leaves git's own `.git/worktrees/<name>` metadata "prunable" and
the CLI's registry pointing at a manifest entry whose path no longer exists.

`add-repo`, `remove-repo`, `list`, and `status` all run a cheap reconcile pass
before trusting cached state: `git worktree list --porcelain` + `git worktree
prune` against the repo cache, plus a filesystem existence check per manifest
entry. This is built into `core`'s orchestration layer, not left as a
per-command afterthought.

### Locking around the shared cache

Because a repo's cache is shared across workspaces, two concurrent `spork`
invocations touching the same repo (two scripted `add-repo` calls, parallel CI
jobs) can race on `git fetch`/`worktree add` against the same `.git` dir. A
per-repo-source lock (via the `proper-lockfile` package) around clone/fetch/
worktree-add mutations avoids this at low cost.

### Registry is an index, not a source of truth

`~/.spork/workspaces.json` maps a workspace name to its manifest path, so
`spork workspace list` doesn't need to scan the filesystem. Every read verifies
the manifest still exists and self-heals (drops and reports) missing entries
rather than trusting the registry blindly. Commands also accept a raw path as a
fallback when a name isn't registered — cheap insurance against registry drift.

### Package split: `core` + `cli`, not three packages

A standalone `packages/git` wrapper package was considered and rejected for v1:
it would have exactly one consumer (`core`), and a third package.json/README/
CLAUDE.md/project-reference doesn't buy real isolation at this scale. `core`
has an internal `src/git/` module instead, with `exec.ts` as the single spawn
point — that's the seam unit tests mock, giving the same testability without the
extra package.

`cli` may only import `core`'s declared `src/index.ts` exports, never reach into
`core/src/*` directly. This is enforced by TypeScript project references (see
root `tsconfig.json`), not just convention.

### Testing strategy: unit tests only, ≥80% coverage, for now

Every new feature ships with unit tests in the same change, targeting ≥80%
coverage (lines/functions/branches/statements), enforced by vitest's coverage
thresholds in CI. Anything that would spawn a real external process — actual
`git` invocations, the `code` CLI — is exercised via **mocked** exec calls, not
real subprocesses. Manifest/registry/`.code-workspace` file I/O is tested
against real temp files, since plain filesystem access isn't the kind of
external-tool-call flakiness this restriction is about.

Real-subprocess-driven integration tests are deliberately deferred to a later
phase — they're slower and more environment-dependent, and getting the unit-level
design (mockable exec seam, reconcile logic, locking) right first makes that
follow-up easier rather than harder.

### `status` is local-only

"Per-worktree status" means local dirty/branch state, not ahead/behind the
remote — that would require a network round-trip per worktree on every call,
which doesn't match the expectations set by plain `git status`. An ahead/behind
view (behind a `--fetch` flag or similar) is a later-phase concern.

### Repo sources have a persistent alias, separate from workspaces

A repo source (a clone URL or local path) is cloned once into a shared cache,
but until now that cache had no name a user could refer back to — every
`add-repo` needed the full source again, even for a repo spork already had.
`registry/repoRegistry.ts` (`~/.spork/repos.json`, alias → source) and
`repo/repos.ts`'s `addRepoSource` fix that: every successful clone/fetch
registers (or reuses) an alias, opportunistically — no separate step
required.

This also splits what was one `withRepoLock` block into two short ones:
`addRepoSource` locks around ensuring the cache exists (shared with the
top-level `repo add` command — see below), and `addRepo` then takes a
second, separate lock just around `addWorktree`. The tiny window between
them is harmless — nothing outside a lock mutates a cache — and it means
`repo add` reuses `addRepoSource` verbatim instead of duplicating
clone-and-register logic.

A parallel `spork repo` CLI command group (`add`/`list`/`remove`) exposes
this registry directly, decoupled from any workspace — see
[packages/cli/README.md](../../packages/cli/README.md). `repo add` uses
`addRepoSourceOrAlias` (resolve-then-add in one call — it has no
folder-collision check to order around, unlike `workspace.ts`'s `addRepo`,
so it doesn't need the two-step split). `repo remove` hard-refuses if
`findRepoUsages` finds any workspace still referencing the source, via a
scan of the workspace registry and every workspace's manifest — no
force-override, since a worktree is a live pointer into the cache's object
store and deleting it out from under one would corrupt it.

`workspace create` grew a repeatable `--repo <source-or-alias>` flag as
sugar over calling `add-repo` once per repo — implemented purely in the CLI
layer (`runCreateWithRepos` calls `addRepo` directly for every `--repo`,
concurrently, through `@spork/task-runner`'s dashboard — see
`concurrentTasks.ts` in [packages/cli/README.md](../../packages/cli/README.md)),
not as new core surface. Not atomic, and no longer fail-fast as of the
task-runner integration: every `--repo` runs regardless of a sibling's
failure (same "best effort over a batch" precedent `repo scan` already
uses), so the already-created workspace ends up with whatever repos
succeeded — recoverable via `add-repo` for the rest. Unlike `repo scan`'s
best-effort bulk-adopt, though, a failed or cancelled `--repo` here is
still something the caller explicitly asked for and didn't get, so every
outcome gets printed and the command then throws (after printing, not
before), keeping the process exit non-zero.

This also settled a CLI taxonomy question: `workspace add-repo`/
`remove-repo` keep their `-repo` suffix rather than shortening to bare
`add`/`remove` now that `repo add`/`remove` exist at the top level — the
suffix is what keeps `workspace remove` (destroy the whole workspace)
unambiguous from `workspace remove-repo` (drop one repo from it). A verb's
meaning being scoped by its noun group is normal CLI practice (git's
`remote add` vs `submodule add` don't collide either).

#### The registry is two-tier: local and global, npm-flavored but not npm's defaults

A single global namespace meant an alias had to mean the same thing forever,
everywhere — two workspaces couldn't both sensibly have an "api" alias for
different repos. The fix, discussed against the npm local/global-install
analogy: the **cache always stays global** (`repoCacheId` is a pure function
of the source string, with no notion of scope — duplicating a full clone per
workspace the way `node_modules` duplicates a package would undermine the
entire shared-cache design), but the **alias namespace is two-tier**:

- `registry/repoRegistry.ts`'s `localRepoRegistryPath(workspaceDir)` →
  `spork.repos.json`, sitting next to that workspace's manifest. It's the
  *same* `registerRepoAlias`/`listRepoAliases`/etc. functions pointed at a
  different path — they were already parameterized by an arbitrary
  `registryPath`, never assumed global, so this needed no rework of them.
- `resolveScopedRepoAlias(reposRoot, localRegistryPath, globalRegistryPath,
  aliasOrSource)` composes the two: local match wins, then global, then the
  raw input — same precedent as node_modules resolution. `workspace.ts`'s
  `addRepo` uses this (instead of the single-registry `resolveRepoAlias`) so
  it accepts a local alias, a global one, or a raw source, and always stores
  the *resolved* source in the manifest, never the alias.
- `addRepo` registers new aliases **locally to the workspace by default**
  (`AddRepoOptions.global` opts into the shared registry instead) — the
  target workspace is always known there, so there's no ambiguity to
  resolve. This is deliberately the **opposite of npm's convention**, where
  local is the unmarked default and global requires `-g`: npm defaults local
  because JS dependencies are normally fine to duplicate per-project, but a
  repo alias's whole motivating use case was cross-workspace reuse ("don't
  make me retype this URL for a second workspace"), so global-by-default
  would have quietly brought that annoyance back. `AddRepoResult` gained
  `aliasScope` so callers can report which happened.
- `removeRepoSource`'s in-use check (`findRepoUsages`) is **not** scope-
  dependent, even though a naive reading of "local removal only affects one
  workspace" suggests it could be simpler. It can't be: the cache being
  deleted is shared regardless of which alias file named it, so
  `removeLocalRepoAlias` (the new local-scoped sibling of `removeRepoSource`,
  sharing a private helper with it) still runs the exact same global,
  every-workspace scan before touching the cache. A test proves this
  explicitly — removing a local alias is still blocked by a *different*
  workspace's worktree on the same source.

The standalone `repo` commands are where scope actually needs deciding, since
they take no workspace argument: `packages/cli/src/repoScope.ts`'s
`resolveRepoScope` makes it context-sensitive — `--global`/`--local` are
explicit overrides, and with neither, local wins if `findEnclosingWorkspaceDir`
(walking up from cwd for a `spork.workspace.json`, like git's `.git` walk)
finds an enclosing workspace, global otherwise (there's nothing to be local
*to* outside one). Every confirmation prints the resolved scope
(`describeRepoScope` → `"local to \"demo\""` / `"global"`), so this is never a
silent cwd-dependent surprise. `repo list` is the exception to "pick one
scope": its default is a **merged** view (local plus global, each row
tagged), since the point of listing is visibility, not picking a winner.
`workspace` commands never call any of this — they already know their target
workspace by name, so there's no ambiguity `resolveRepoScope` could resolve.

### Bulk-adopting an existing folder of clones (`spork repo scan`)

A lot of people already keep every repo they use cloned in one folder
(`~/code`, `~/src`, ...). Two ways to make spork work with that were
considered: point a workspace's worktrees directly at the user's existing
clone ("adopt in place"), or use that folder purely as a fast on-ramp into
spork's existing managed-clone model. The second won — it needs no new
"external vs. managed" registry concept and no new "never delete this"
invariant (the riskiest part of adopting in place: a worktree is a live
pointer into its bare repo's object store, and an externally-owned one
could be moved or deleted out from under spork at any time). Every repo
`spork repo scan` adopts ends up a normal, fully independent, fully
disposable managed clone, exactly like one added by typing a URL — the only
difference is *how fast* getting there is, since `git clone --bare
<local-path> <dest>` hardlinks the object database by default when source
and destination share a filesystem, making a local-to-local clone close to
free on disk and far faster than a network clone.

This needed `addRepoSource`/`ensureRepoCache` to separate two things that
used to be the same string: **where to clone from** and **what identifies
the cache**. `ensureRepoCache` gained an optional `cloneFrom`, and
`addRepoSource` gained `cloneFrom` plus `correctOriginTo` — on a fresh
clone only, `correctOriginTo` rewrites the new clone's `origin` remote
(via the new `git/remote.ts`), since a local clone's origin otherwise
defaults to the path it was cloned from, which would leave spork's supposedly
independent copy silently pointing back at the user's folder (and breaking
outright if that folder is later moved). `repo/scan.ts`'s
`scanAndAddRepos` reads each discovered repo's real `origin` (via
`getRemoteUrl`, added alongside `setRemoteUrl`) and uses that as the
cache's identity when present — so a repo found by scan and the same repo
added later by typing its URL resolve to the same cache, not a duplicate —
falling back to the repo's resolved local path as identity when it has no
remote. All of this reuses `addRepoSource` verbatim; no new alias-collision
or registration logic was needed.

The same local-clone-source problem affects more than `origin`: a bare
clone's `HEAD` is set, at clone time, to whatever branch the clone source
had checked out — for a typed-in URL that's always the repo's real default
branch, but for `repo scan`'s local-path clone source it's just whichever
branch happened to be checked out in the user's folder, which upcoming
features that need to know "this repo's default branch" can't rely on.
`addRepoSource` gained a matching `correctHeadTo`, repointing the fresh
clone's `HEAD` (via the new `setHeadBranch`) at the branch name
`scanAndAddRepos` resolves directly from the real `origin` via the new
`getRemoteDefaultBranch` (`git ls-remote --symref <source> HEAD` — a
one-shot read that works against a URL or local path without needing
anything cloned first, same fail-open-to-`null` convention as
`getRemoteUrl`). A repo with no `origin` keeps its local checkout's branch
as `HEAD` uncorrected, same as before — there's no upstream default to
correct it against.

`scanAndAddRepos` skips and continues past a per-repo failure rather than
failing the whole scan (`create --repo` later adopted this same "run
everything regardless of a sibling's failure" shape once it got wired into
`@spork/task-runner` — see above). A scan operates over *discovered*
repos, potentially dozens, where one broken or corrupt entry shouldn't
block adopting the rest — and unlike `create --repo`, which still signals
an incomplete result via a non-zero exit, a scan's whole point is best-
effort discovery, so it always reports what it found via `skipped` rather
than treating any of it as a command failure. `findGitRepoDirs` only looks
one level deep (immediate subdirectories with a `.git` entry) rather than
walking recursively, matching "a single flat folder of clones" rather than
an arbitrary directory tree.

### `open` uses the `code` CLI, via an injectable opener

`spork workspace open` shells out to the `code` CLI rather than OS-level `open`,
since file-association with VS Code isn't guaranteed and generic `open` behaves
unpredictably in CI/non-interactive environments. The opener is an injected
dependency so it's mockable in tests and swappable later (e.g. for a different
editor) without touching command logic. If `code` isn't found, the command
prints the workspace's `.code-workspace` path instead of failing silently.

### Submodules

`git worktree add` doesn't initialize or update submodules on its own — that's
a general git limitation, not specific to spork's worktree strategy. After a
worktree is created, `addRepo` checks the new worktree for a `.gitmodules` file
(`git/submodule.ts`'s `hasSubmodules`) and, if present, runs `git submodule
update --init --recursive` in it. This happens **after** `withRepoLock` is
released, since submodule init is per-worktree state, not shared-cache state —
no reason to hold up other spork operations on the same repo cache while
(potentially slow) submodule clones happen.

A submodule-init failure (e.g. no access to a private submodule remote) does
not fail the add: the top-level repo checked out fine and is still registered,
so `addRepo` returns `{ entry, submodulesInitialized: false, submoduleWarning
}` rather than throwing — the CLI surfaces the warning but treats the add as
successful. Nested submodules-of-submodules are handled by `--recursive`;
a submodule that itself needs authentication delegates to the same system
git credential setup as everything else here.

### Live concurrent display, via `@spork/task-runner`

A new standalone package, `@spork/task-runner`, runs one or more tasks
concurrently and renders a terminal dashboard while they run (per-task
status icon/name/duration, a tail of its own output beneath it). Every
task gets a fixed, equal portion of the terminal's full height for its
pane, split evenly across the total task count and unchanged for the
whole run, rather than a settled task collapsing and handing its rows to
one still going — see
[packages/task-runner/README.md](../../packages/task-runner/README.md).
None of spork's own operations are "spawn one process and tail it" — they're
async TypeScript calling into `@spork/core`, which has no subprocess to
tail — so the package's `Task` type covers both a real spawned process
(`ProcessTask`) and an arbitrary async function (`FunctionTask`, reporting
its own progress lines). Every current `spork` command that benefits from
this (`repo scan`, `repo add`, `workspace add-repo`, `workspace create
--repo`) goes through one shared CLI-layer adapter,
`packages/cli/src/concurrentTasks.ts`'s `runConcurrently`, rather than each
command talking to `@spork/task-runner` directly.

Cancellation for a `FunctionTask` is necessarily **cooperative only**: there's
no child process to forcibly kill if an abort fires mid-`await`, so the task
just settles (as `cancelled`) once its call actually returns. Giving it the
same forceful guarantee `ProcessTask` has would mean threading an
`AbortSignal` through `execGit`/`execFile` (which does support one) into
every `@spork/core` function this touches — not done as part of this
integration, and a reasonable candidate for later if it turns out to
matter in practice.

A single-item command (`repo add`, `workspace add-repo`) still re-throws
the real error on failure, preserving this project's existing "let it
propagate to the top-level handler" convention — `runConcurrently`'s
outcome carries both the raw thrown value (`error`) and a derived string
(`errorMessage`) for exactly this reason: a batch command reports
`errorMessage` and moves on, a single-item one re-throws `error`.

### Interactive repo picking, via `@spork/prompts`

`workspace create` used to always add an empty workspace when no `--repo`
was given — the only way to add repos at all was typing each source or
alias as its own `--repo <x>`. A new standalone package, `@spork/prompts`,
adds a fuzzy-searchable single/multi-select list prompt (`select()`), and
`workspace create` now offers one when no `--repo` was given and there's
something registered to pick from (see
[packages/prompts/README.md](../../packages/prompts/README.md) for the
package itself).

This is a deliberate change to a convention `packages/cli/CLAUDE.md` used
to state explicitly: commands stayed non-interactive in v1, explicit
flags/args only, so every command behaved identically unattended in CI.
That convention is revised, not dropped — an interactive prompt is now
sanctioned, but strictly as an *addition*: every command that offers one
must still work exactly as before when it can't prompt (no TTY) or wasn't
asked to (an explicit flag was already given). `select()` enforces the
"can't prompt" half itself — it throws a plain `NotInteractiveError`
synchronously rather than hanging on keypresses that will never arrive,
and deliberately has no opinion on what the caller should do instead,
since that's a different decision per command (empty workspace here;
some other command might want to require a flag instead). `workspace
create`'s `resolveRepoSources` catches exactly that error and falls back
to the old behavior unchanged; a real cancel (the user opened the picker
and hit Esc/Ctrl+C) is different from "couldn't prompt at all" — `select()`
resolves that as `null` rather than throwing (the same "cancelled is a
normal, resolved outcome" shape `@spork/task-runner`'s `TaskResult`
already uses), and the CLI layer turns a `null` into a thrown
`SporkError('Cancelled.')`, same as every other cancelled-prompt path in
this CLI.

`@spork/prompts` itself splits pure decision logic (fuzzy matching, the
select state reducer, frame rendering — all plain functions, fully unit
tested with no stream involved) from the one place that touches a real
stream (`terminal.ts`'s `runSelectPrompt`), mirroring `@spork/task-runner`'s
own pure-vs-stateful split. A selection is tracked by the option's
original index rather than its position in the filtered view, so
narrowing a search and then clearing it doesn't lose what was already
picked — select/deselect-all only ever toggles the *currently filtered*
set, leaving anything filtered out untouched. Real `node:readline`
keypress decoding against an actual terminal was verified manually
(there's no interactive TTY available to type into in this sandboxed
environment, so a real pseudo-terminal was driven programmatically
instead via Python's `pty.fork`) rather than by the automated suite, which
drives `terminal.ts` with synthetic `'keypress'` events on a fake stream.

`@spork/prompts` also has a second, simpler prompt: `confirm()`, a
yes/no question. `workspace create` uses it to ask whether to open the
new workspace in VS Code right after creating it — a workspace is
created to be worked in, so offering to jump straight into it removes a
manual `spork workspace open <name>` most people would type next anyway.
Same `NotInteractiveError`/no-TTY handling as `select()`, and it reuses
the same injectable `Opener` (`packages/cli/src/opener.ts`) `workspace
open` already uses, rather than inventing a second way to shell out to
the `code` CLI. Unlike `select()`, `confirm()` has no separate
"cancelled" outcome — Esc/Ctrl+C just resolve `false`, same as answering
"no", since nothing downstream needs to tell a decline from a bail-out
apart (either way, the workspace just doesn't open automatically; `spork
workspace open <name>` still works whenever the user wants it).

### Concurrent writes to the manifest/registries needed their own lock

Making `repo scan`/`workspace create --repo`/the interactive picker run
concurrently (see "Live concurrent display" above) surfaced a bug those
commands didn't have when they were sequential: `workspace create demo
--repo a --repo b --repo c` would create all three worktrees on disk, but
`spork.workspace.json` and the generated `.code-workspace` would end up
with only one of them — the other two silently vanished. The repo alias
registry had the identical bug (`repo scan` over several repos could lose
one's registration the same way).

The cause was a classic lost update: `addRepo`/`registerRepoAlias` each
read the manifest/registry file, mutated an in-memory copy, and wrote it
back — safe one at a time, but with several calls running concurrently
via `@spork/task-runner`, two of them could both read the same
pre-mutation snapshot and then each write their own addition back over
the other's, with no error to signal it. "Locking around the shared
cache" above already solved this exact shape of problem for the repo
cache itself (`withRepoLock`, via `proper-lockfile`), but that lock only
ever covered the cache directory — not the separate manifest/registry
JSON files `addRepo` and friends also read-mutate-write.

The fix, `packages/core/src/util/fileLock.ts`'s `withFileLock`, applies
the same `proper-lockfile` mechanism to those files instead: every
function that mutates a manifest or a registry (`workspace.ts`'s
`addRepo`/`removeRepo`/`reconcileWorkspace`; `registry.ts` and
`repoRegistry.ts`'s register/unregister/self-heal) now wraps its whole
read-mutate-write cycle in a lock on that file, **re-reading fresh from
inside it** rather than reusing an earlier read — the re-read is what
actually closes the race; locking around a stale snapshot would just
serialize the same lost update. Unlike `withRepoLock`, `withFileLock`
doesn't pre-create its target before locking: a repo cache directory
always needs to exist to do real work inside it, but a registry file is
meaningfully *absent* until its first write, and callers' `existsSync`
checks rely on that to know to start from an empty default. `realpath:
false` lets `proper-lockfile` lock a path that doesn't exist yet instead.

## Explicitly deferred

Not designed in depth here — the architecture above doesn't foreclose any of
these, but they're out of scope for the v1 slice this doc accompanies:

- Deeper git/PR enrichment via the `gh`/git CLI.
- A VS Code extension.
- Swapping yarn workspaces for Nx.
- Populating each generated workspace folder with its own AI-friendly
  conventions (skills/CLAUDE.md) — the *repo* has these; workspaces `spork`
  generates for users don't yet.
- Real-subprocess integration tests.
- Repo-source identity/dedup (the same repo added via HTTPS and SSH is treated
  as two different sources today).
