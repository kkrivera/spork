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

### Shared bare clone, one branch per workspace, shared by every repo in it

Each repo source is cloned once, as a `git clone --bare` cache under
`~/.spork/repos/<id>/` — never re-cloned per workspace. Every worktree is created
against that shared cache via:

```
git worktree add -b <workspace-name> <path> <start-point>   # branch doesn't exist yet
git worktree add <path> <workspace-name>                    # branch already exists — reuse it as-is
```

`<workspace-name>` is used verbatim — not slugified, no prefix — so every
repo added to a given workspace ends up checked out on the exact same
branch name. This matches a real cross-repo workflow: one ticket/feature
branch (`workspace create krisrivera/gw-2-fix`, say) shared across every
repo it touches, pushable as-is for a PR from any of them. The manifest
still records both the user's requested ref (what they asked to check out)
and the actual local branch (what git has checked out), so
`add-repo --branch <ref>` behaves the way users expect.

This is a deliberate trade against an earlier design, which gave every
*worktree* its own branch (`spork/<workspace-slug>/<folder-slug>`)
specifically to make collisions structurally impossible — the shared bare
clone meant `git worktree add <ref>` would otherwise fail the moment two
workspaces (or two worktrees in one workspace) touched the same repo+branch,
a routine scenario, not an edge case. Dropping that per-worktree uniqueness
trades structural impossibility for two narrower, explicitly-handled cases:

- **The same repo added twice to one workspace** — still impossible by
  construction (one shared branch means both worktrees would need to check
  out the identical branch in the identical repo cache at once). `addRepo`
  checks for this upfront and fails with a clear `SporkError` naming the
  existing folder, rather than letting git's own "already checked out
  elsewhere" surface confusingly.
- **A branch with the workspace's name already existing in a repo's
  cache** — e.g. a previous, removed workspace of the same name touched
  this repo before and its branch is still sitting there. `addWorktree`
  (`git/worktree.ts`) checks for this first (`branchExists`) and, when it's
  there, checks it out as-is — continuing its history — rather than trying
  (and failing) to create a duplicate. This is deliberately *reuse*, not
  recreate: the branch is a real, meaningful, potentially-pushable one now,
  not disposable `spork/...` plumbing, so picking up where a previous,
  removed workspace of the same name left off is exactly what's wanted.
  Removing a workspace (`removeRepo`/`removeWorkspace`) never deletes the
  branch either, for the same reason — only the worktree, which is what
  makes recreating the workspace later able to find and resume it. The one
  thing this can't resolve is the branch being checked out *elsewhere right
  now* (a genuinely different, concurrent conflict) — git can only ever
  check out a given branch in one worktree at a time, so `addRepo` catches
  that failure (`isWorktreeCollisionError`; `isBranchExistsError` is kept
  as a defensive fallback for a check-then-act race, though the upfront
  check means it shouldn't normally fire) and fails with a clear
  `SporkError` naming the cache path, rather than silently working around
  something it fundamentally can't.

Workspace names are already kept unique by the workspace registry
(`registerWorkspace` refuses a duplicate), which is what makes "one
verbatim branch per workspace" a reasonable bet in the first place, with
the two cases above as the explicit, narrow fallback when it doesn't hold.

Since every worktree's branch *is* the workspace's own name, that name has
to mean the same thing everywhere it shows up — so `workspace create
<name>`'s folder is always `<name>` too, not an arbitrary one. `--dir
<path>` is a *parent* directory (the workspace lands at `<path>/<name>`),
never the exact target — letting it name the folder directly would let a
workspace's on-disk folder and its branch disagree about what it's even
called. `<name>` may itself contain `/` (a `username/ticket-slug`
convention, say) — `mkdir(..., { recursive: true })` and `path.resolve`
already handle that correctly for the folder (nested directories, no extra
code needed), and git ref names support `/` as hierarchy the same way a
`feature/foo`-style branch does, so the branch needs no special handling
either — except that the generated `.code-workspace` file's own name uses
only `name`'s last segment (`path.basename`), not the whole thing, since
the workspace directory is already nested and using the full name again
would try to nest the file under a non-existent extra subdirectory.

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

`workspace open <name>`'s name argument is itself now optional, using
`select()` a second way: omit it and `open` lists every registered
workspace and offers a single-select instead of requiring you to already
know (or retype) the name. Unlike `create`'s repo picker, there's no
sensible non-interactive fallback for `open` without a name — it can't
guess which workspace you meant — so `NotInteractiveError` becomes a
`SporkError` asking for the name explicitly rather than being swallowed.

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

### `fetchAll` was never actually refreshing branches

A repo's cache is supposed to stay current via `ensureRepoCache`'s
"fetch if already cloned" path — but `fetchAll` (`git fetch --all --tags`)
turned out to be a near-complete no-op for that purpose, confirmed by
directly testing against a real bare clone: pushing a new commit upstream
and re-fetching inside the cache left `refs/heads/main` exactly where it
was at clone time. The fetch only updated `FETCH_HEAD`.

The cause: `git clone --bare` deliberately does not configure a fetch
refspec — "neither remote-tracking branches nor the related configuration
variables are created" (git-clone(1)), unlike a normal clone, which sets
one mapping the remote's branches into `refs/remotes/origin/*`. Without
any refspec at all, a bare clone's own `git fetch` has nothing telling it
what to do with the branches it downloads, so they only ever land in
`FETCH_HEAD` and the cache's actual `refs/heads/*` — what `addWorktree`'s
`-b <branch> <path> HEAD` actually builds a fresh branch from — never
moved past whatever it was at clone time. In practice this meant adding a
repo to a workspace long after it was first cached (by any earlier
`repo add`/`repo scan`/another workspace) silently started the new
worktree from a stale snapshot instead of the real upstream tip.

The fix: `fetchAll` now runs `git config remote.origin.fetch
+refs/heads/*:refs/heads/*` immediately before every fetch — `git config`
replaces rather than accumulates, so it's cheap and safe to re-assert on
every call rather than needing to have been set once at clone time (which
also means an already-existing cache from before this fix self-heals the
next time anything touches it, no migration needed). Deliberately **not**
`--mirror` and deliberately no `--prune`: either would make fetch
*delete* any local `refs/heads/*` entry missing from the remote side —
and every spork-owned workspace branch (`spork create <name>`'s verbatim,
shared-per-workspace branch — see above) is exactly that: local-only,
never pushed upstream. A mirroring or pruning fetch would silently delete
a user's own in-progress workspace branches the next time any sibling
`addRepo` call happened to touch the same repo's cache.

### Every `workspace <verb>` can omit its workspace argument, and destructive ones confirm

`workspace open <name>`'s name was the first argument made optional (see
above); this extends the same idea to every other subcommand that takes an
existing workspace by name — `add-repo`, `remove-repo`, `remove`, and
`status` — and adds a second, independent change: a destructive command now
always asks for confirmation before acting, not just when its target came
from a picker.

`pickWorkspace.ts` factors the picker itself out of `open.ts` into a shared
`pickWorkspaceName`/`pickWorkspaceNames`, so every command gets the same
`NotInteractiveError`→`SporkError` wording and resolves to a workspace
*name* (not a directory) the same way `open` already did. `remove` takes
its workspaces as a variadic `[workspaces...]` and offers a *multi*-select
when none are given — unlike every other command here, removing several
workspaces in one pass is a real, common case (cleaning up a batch of
finished branches), not just an omitted single argument. `remove-repo`
makes both of its positionals optional (`[workspace] [folder]`): a folder,
once the workspace is known, is picked from that workspace's own worktrees
rather than requiring it up front.

`add-repo`'s two positionals couldn't use the same plain "declare both
optional, let commander fill left-to-right" approach `remove-repo` uses,
because of *which* argument needs to stay effectively required: commander
always assigns a lone argument to the *first* declared slot, but `source`
(the second slot) is the one that can never be prompted away — there's no
sensible picker for "which repo", only for "which workspace". So
`resolveAddRepoArgs` captured both positionals as plain optional strings
and disambiguated by count itself: two arguments kept the
`<workspace> <source>` order; a lone argument was always `source`, with
`workspace` left for `runAddRepo` to prompt for. (This count-based
disambiguation was later replaced by a `--workspace` flag once omitting
`source` entirely — to pick from the repo registry — became the more
common case; see "`add-repo` defaults to picking from the repo registry"
further below for why and what changed.)

The confirmation half is a separate, shared gate: `confirmDestructive.ts`
wraps `@spork/prompts`' `confirm()` and applies to `remove`/`remove-repo`
*regardless* of whether the target was typed explicitly or picked — the
risk is the action, not how the target was chosen. A command's own
`--yes`/`-y` flag skips the prompt outright (the bypass a script or CI run
needs, since there's nothing to answer without a TTY anyway); without
`--yes` and without a TTY, `confirmDestructive` fails with a clear
`SporkError` demanding `--yes` instead of silently proceeding with, or
silently skipping, something destructive — consistent with this project's
existing preference for failing loudly over guessing (see the branch-
collision handling above). Declining the prompt itself is
`SporkError('Cancelled.')`, same as every other cancelled-prompt path in
this CLI.

### `remove`'s batch removal moved off a plain sequential loop

Removing several workspaces at once (`spork workspace remove a b c`, or a
multi-select with several chosen) originally ran through a plain `for`
loop, awaiting one `removeWorkspace` at a time with nothing printed until
every workspace had finished — the whole batch looked frozen and then
dumped every result at once. Since `run<Verb>` functions in this CLI never
`console.log` themselves (`register<Verb>Command` always owns printing),
a sequential loop like that has no way to surface progress as it happens
— the caller only ever sees the final, fully-resolved array.

The fix: `runRemove` now builds one `runConcurrently` item per workspace,
the same live-dashboard mechanism `create --repo a --repo b ...` and
`repo scan` already use (including its automatic fallback to a plain
streamed `[name] line` mode when stdout isn't a TTY — CI, a pipe). Nothing
about removing one workspace actually depends on another: each only
touches its own directory and registry entry, and the one genuinely
shared resource — a repo's cache, when the same source is used by more
than one workspace — is already protected by its own lock
(`removeRepo`'s `withRepoLock`), not by the CLI calling things in a
particular order. So there was no real correctness reason for the
sequential loop in the first place, just an accident of how the variadic
signature was first written. Best-effort, not fail-fast, matching
`runCreateWithRepos`/`repo scan`'s existing precedent: every workspace is
attempted regardless of a sibling's failure, and `registerRemoveCommand`
throws only after printing every outcome, so one failure can't silently
swallow the removals that did succeed.

This generalizes: any future multi-item `run<Verb>` must stream progress
rather than buffer it, whether or not its items can run concurrently.
`runConcurrently` is the default answer when they can (it gets you live
progress for free). If a future operation's items genuinely cannot be
reordered, `run<Verb>` still can't go silent for the whole loop — it
needs a per-item callback invoked as each one settles, mirroring how
`runConcurrently`'s `TaskReporter.log()` lets a concurrent item report
progress without `run<Verb>` calling `console.log` directly. No command
needs that today, so it isn't built speculatively — see
`packages/cli/CLAUDE.md`.

### `add-repo` defaults to picking from the repo registry, and cwd auto-detects the workspace

Cloning an entirely new, unregistered repo turned out to be the rare case
for `add-repo`, not the common one — most of the time the repo in
question was already scanned/registered (via `repo scan`/`repo add`)
elsewhere, and retyping its full source every time was pure friction. Two
changes address that:

**`pickWorkspaceName` (single-select only) now auto-detects the cwd's
enclosing workspace first**, via `@spork/core`'s `findEnclosingWorkspaceDir`
— the same convention `repoScope.ts` already uses for `spork repo`'s
local/global default. If `cwd` is already inside a registered workspace,
every command that falls back to `pickWorkspaceName` (`add-repo`,
`remove-repo`, `status`, `open`) resolves to it directly, with no prompt at
all — there's nothing ambiguous to ask about. `pickWorkspaceNames` (the
multi-select `remove` uses) deliberately does **not** get this: picking
several workspaces at once is the entire point of a multi-select, so
collapsing it to "just the one you're sitting in" would work against that
rather than help it.

**`add-repo`'s `[source]` is now the only positional, with workspace moved
to a `--workspace`/`-w <name>` flag.** The previous design — two optional
positionals, `[workspace] [source]`, disambiguated by argument count
(`resolveAddRepoArgs`) — worked for "is `source` always required" but broke
down once the *common* invocation became "I know the workspace, let me pick
repos interactively": `spork workspace add-repo demo` would have treated
`demo` as a repo source to clone (and failed confusingly) rather than as
the workspace to add registered repos to, because a lone positional
argument can't tell those two meanings apart without guessing. Moving
`workspace` to a named flag removes the ambiguity entirely rather than
trying to resolve it more cleverly: `[source]` is unambiguous on its own
(it's the only positional there is), and `--workspace` is either given or
it isn't.

**Omitting `[source]` lists every registered repo** (the same merged
local+global view `repo list` shows) and offers a multi-select, reusing
`addReposBatch.ts`'s `addReposToWorkspace` — the exact same concurrent,
best-effort batch-add logic `create --repo a --repo b ...` already used,
now extracted into its own module so both call sites share one
implementation instead of two copies drifting apart. `--branch`/`--as`
only make sense for one explicit source (which ref to check out, what to
name its folder) — they can't generalize across an arbitrary multi-repo
pick, so passing either without `[source]` is a clear, immediate error
rather than silently applying to every picked repo or silently being
ignored.

Adding a genuinely new, unregistered repo is still fully supported — pass
it as an explicit `[source]`, same as before; nothing about that path
changed.

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
