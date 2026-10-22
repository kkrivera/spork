# @spork/core

Domain logic for spork: everything the `spork` CLI needs to manage git-worktree
workspaces, with no CLI concerns (parsing, colored output) in it. See
[docs/plans/0001-worktree-workspace-architecture.md](../../docs/plans/0001-worktree-workspace-architecture.md)
for the design this package implements, and
[docs/plans/0003-workspace-init.md](../../docs/plans/0003-workspace-init.md)
for `workspace init`'s adopted-folder/`kind`/`origin` extension to it.

## Structure

- `src/git/` — a thin wrapper around invoking the `git` CLI.
  - `exec.ts` — the single spawn point (`execGit`); every other module here goes
    through it, and it's the seam unit tests mock instead of spawning real `git`
    processes. Runs git with prompts **off** by default (`auth.ts`'s
    `NO_PROMPT_ENV`), so an SSH passphrase, HTTPS password, or unknown host
    key fails fast instead of hanging on a prompt nobody can see (the MCP
    server, CI, or a live dashboard redrawing over it). `allowPrompts: true`
    opts back in, for a caller with a person at a real terminal and nothing
    drawing over it. An auth failure throws `GitAuthError` (a
    `GitCommandError` subclass) whose message ends with what to do next.
  - `auth.ts` — `NO_PROMPT_ENV`, `isAuthFailure(stderr)`, and
    `authFailureGuidance(allowPrompts)`: the env that disables prompts
    (`GIT_TERMINAL_PROMPT=0`, plus ssh forced onto an always-failing
    askpass so a user's own `core.sshCommand` stays untouched), the stderr
    patterns that mean "couldn't authenticate," and the next steps shown for
    one (ssh-agent, accepting a host key, an HTTPS credential helper).
  - `clone.ts` — bare-clone creation, fetching, and ref resolution against a
    shared repo cache. `fetchAll` configures the cache's fetch refspec
    (`remote.origin.fetch = +refs/heads/*:refs/heads/*`) before every fetch,
    re-asserting it rather than relying on it being set once — `git clone
    --bare` deliberately doesn't set one (git-clone(1)), so without this,
    `git fetch` only updates `FETCH_HEAD` and the cache's branches stay
    frozen at whatever they were at clone time, confirmed by direct
    testing. Deliberately no `--prune`: that would delete any local
    `refs/heads/*` entry missing from the remote, including every
    spork-owned workspace branch (local-only, never pushed upstream).
    `setHeadBranch(bareRepoPath, branch)` repoints the cache's own HEAD, for
    correcting it after a clone whose source wasn't the repo's real
    upstream (see `repo/scan.ts` below) — safe even if `branch` doesn't
    exist in the cache yet, since HEAD can symbolically point at a
    not-yet-existent ref and resolves once a later fetch brings it in.
  - `worktree.ts` — worktree add/remove/prune/list. `addWorktree` always
    checks out one local branch per workspace — the *workspace's own name*,
    verbatim, shared by every repo in it, never the requested ref directly
    (see the design doc for why) — via `branchExists` first: reuses it
    as-is (continuing its history) if it already exists in this repo's
    cache, otherwise creates it fresh from the start point, and reports
    which happened (`AddWorktreeResult.reusedExistingBranch`).
    `isWorktreeCollisionError` recognizes git refusing because the branch
    is checked out *elsewhere right now* (the one thing reuse can't
    resolve); `isBranchExistsError` is a defensive fallback for the
    equivalent "branch already exists" failure, kept in case of a
    check-then-act race (`addWorktree`'s own check means it shouldn't
    normally fire). `workspace.ts`'s `addRepo` turns either into a clear
    error rather than letting git's own failure surface.
  - `status.ts` — local-only worktree status (branch + dirty file count, no
    fetch).
  - `remote.ts` — `getRemoteUrl`/`setRemoteUrl`, used by `repo/scan.ts` to
    read a discovered repo's real upstream (returning `null` rather than
    throwing if it has none) and to correct a fresh local clone's `origin`
    back to that upstream afterward. `getRemoteDefaultBranch(source)` asks a
    URL or local path directly what its default branch is (`git ls-remote
    --symref <source> HEAD`), without needing it cloned first — same
    fail-open-to-`null` convention as `getRemoteUrl`.
  - `submodule.ts` — `hasSubmodules` (checks for a `.gitmodules` file) and
    `initSubmodules` (`git submodule update --init --recursive`), since
    `worktree add` never initializes submodules on its own.
- `src/repo/` — the shared repo cache each workspace's worktrees are created from.
  - `cache.ts` — derives a stable cache id/path from a repo source
    (`repoCacheId`: an owner-prefixed slug when the source is URL-shaped
    enough to have one, e.g. `acme-widgets-<hash>`, so two orgs' same-named
    repo read as distinct cache directories rather than only differing by
    hash; a local path has no owner to extract, so it's just
    `widgets-<hash>`) and ensures a bare clone of it exists
    (`ensureRepoCache`), fetching to refresh refs if it's already cached
    rather than re-cloning. Its `allowPrompts` option is forwarded to
    `cloneBare`/`fetchAll` (and on to `execGit`).
  - `lock.ts` — `withRepoLock`, an exclusive lock (via `proper-lockfile`) around
    mutating a repo cache, since the cache is shared across workspaces and
    concurrent `spork` invocations are expected, not exceptional.
  - `cache.ts` also exports `repoCacheExists`, used by the repo registry
    below to tell whether a registered alias's cache is still actually there.
  - `repos.ts` — the service layer over the repo registry:
    - `addRepoSource(ctx, source, { alias?, cloneFrom?, correctOriginTo?,
      correctHeadTo?, allowPrompts? })` — ensure cloned, then register/reuse an alias for
      it. `allowPrompts` lets the clone/fetch prompt on the terminal (off by
      default — see `git/exec.ts`). Expects a real source, not an alias. `cloneFrom` clones from a
      different (typically local) path than `source` on a fresh clone while
      keeping `source` as the cache's identity; when that produces a fresh
      clone, `correctOriginTo` rewrites its `origin` remote afterward (a
      local clone's origin otherwise defaults to the path it was cloned
      from) and `correctHeadTo` repoints its HEAD at the given branch (a
      local clone's HEAD otherwise reflects whichever branch was checked
      out in the clone source, not necessarily the repo's real default
      branch). All three are used by `repo/scan.ts` below and are no-ops
      for every other caller.
    - `addRepoSourceOrAlias(ctx, aliasOrSource, { alias? })` — the same, but
      resolves an alias-or-raw-source input first (mirroring
      `resolveWorkspaceDir`'s pattern). This is what the top-level `repo add`
      command uses; `workspace.ts`'s `addRepo` resolves separately instead
      (it needs to fail fast on a folder-name collision *before* touching
      the network, so it can't resolve-and-clone in one step).
    - `removeRepoSource` — deletes a cache and forgets its (global) alias,
      but hard-refuses via `findRepoUsages` if any workspace still has a
      *real* worktree checked out from it — no force-override, since that
      worktree is a live pointer into the cache's object store.
      `findRepoUsages` deliberately excludes a `workspace init`-adopted
      entry (`kind: 'adopted'`) even when its `source` matches — it isn't a
      worktree of this cache at all (just a plain folder recorded as
      having come from this source), so deleting the cache can't corrupt
      it the way it would a real worktree. Each returned `RepoUsage` also
      carries `workspaceDir`, not just `workspaceName`/`folder`, so a
      caller (`@spork/cli`'s `repo remove`) can act on a usage directly —
      e.g. calling `workspace.ts`'s `removeRepo` on it — rather than
      needing a second lookup.
    - `removeLocalRepoAlias(ctx, workspaceDir, alias)` — same operation,
      against a workspace's *local* registry instead. The in-use check is
      identical either way (a shared private helper) — it always scans
      every workspace's manifest, regardless of which alias file triggered
      the removal, since the cache being deleted is shared no matter how
      it was named.
  - `scan.ts` — bulk-adopts an existing folder of clones (e.g. `~/code`)
    into the managed cache: `findGitRepoDirs(scanDir)` finds its immediate
    subdirectories that look like git repos (one level deep, not
    recursive), and `adoptLocalRepo(ctx, dir)` clones one of them via
    `addRepoSource`'s `cloneFrom` (from the local checkout, so the clone is
    fast and hardlinked), falling back to its resolved local path as
    identity when it has no `origin`. When it does have one,
    `correctOriginTo` restores that `origin` afterward and `correctHeadTo`
    (resolved from the real upstream via `getRemoteDefaultBranch`, never
    trusted from the local checkout) restores the cache's HEAD to the
    repo's actual default branch — both would otherwise reflect the local
    clone source instead. `scanAndAddRepos(ctx, scanDir)` is the sequential
    convenience wrapper over `adoptLocalRepo` for every discovered dir,
    skipping and continuing past a per-repo failure — collected in the
    returned `ScanResult`'s `skipped` list — rather than failing the whole
    scan, unlike `workspace create --repo`'s fail-fast behavior; that is a
    short, explicitly-typed list, while this operates over discovered repos
    where one broken entry shouldn't block adopting the rest. `adoptLocalRepo`
    is exported separately for a caller that wants to schedule/display
    adopting several repos itself (e.g. concurrently) instead of only
    getting the sequential batch behavior.
- `src/util/` — `slugify` (filesystem/branch-name-safe strings),
  `repoShortName` (the repo's short name out of a source URL/path),
  `repoOwner` (the owner/org segment out of a URL-shaped source, e.g. "acme"
  from `git@github.com:acme/widgets.git` — null for a bare local path, since
  its parent directory isn't a real "owner" and would falsely make every
  repo in a scanned folder look like it shares one), and `fileLock.ts`'s
  `withFileLock(filePath, fn)` — the same `proper-lockfile` mechanism
  `repo/lock.ts`'s `withRepoLock` uses for the repo cache, applied instead
  to a small JSON index file (a manifest or a registry). Unlike
  `withRepoLock`, it doesn't pre-create `filePath` (these files are
  meaningfully absent until their first write), so it locks with
  `realpath: false` rather than requiring the target to already exist.
- `src/config/paths.ts` — spork's local state locations (`~/.spork/repos`,
  `~/.spork/workspaces.json`).
- `src/errors.ts` — `SporkError`, the one error type used for user-facing
  domain failures (a naming collision, a missing entry) as opposed to bugs.
- `src/workspace/` — the workspace lifecycle built on top of `git`/`repo`.
  - `manifest.ts` — the `spork.workspace.json` schema and its read/write.
    An entry is one of two kinds: `WorktreeEntry` (`kind?: 'worktree'`,
    the default — a real git worktree spork created, with `requestedRef`/
    `localBranch`) or `AdoptedEntry` (`kind: 'adopted'` — a folder
    `workspace init` adopted exactly as it already sat on disk, no ref/
    branch fields at all, since spork never asked git to check out
    anything for it). `WorkspaceManifest.origin` is `'created'` (the
    default) or `'initialized'`, independent of any entry's `kind` — it's
    what `removeWorkspace` checks to decide whether the workspace
    directory itself is ever a candidate for deletion (see below). Both
    fields are optional so no manifest written before they existed needs
    migrating.
  - `codeWorkspace.ts` — generates the workspace's `.code-workspace` file from
    its manifest. `codeWorkspaceFilePath(workspaceDir, name)` names the file
    after only `name`'s last path segment (`path.basename`), since `name`
    may itself contain `/` and the workspace directory is already nested
    accordingly — using the whole thing again would try to nest the file
    under a non-existent extra subdirectory.
  - `workspace.ts` — orchestration: `createWorkspace`, `addRepo`, `removeRepo`,
    `removeWorkspace`, `getWorkspaceStatus`, and `reconcileWorkspace` (pruning
    stale git worktree metadata and dropping manifest entries for folders
    deleted by hand — called before every other operation here). Also
    `createAndRegisterWorkspace`/`removeAndUnregisterWorkspace`: each pairs a
    workspace op with its matching registry bookkeeping (create+register,
    remove+unregister) in one call — every frontend that creates or removes a
    workspace at all needs both halves done together (an unregistered
    workspace is orphaned from `list`/`open`/etc.; a registration with no
    workspace behind it is corrupt state), so this is the one place that
    pairing lives rather than `@spork/cli` and `@spork/mcp` each
    re-implementing it. `createAndRegisterWorkspace` checks for a name
    collision against the registry *before* creating anything on disk (so a
    duplicate name fails without leaving an orphaned directory behind);
    `registerWorkspace` itself also rejects a collision atomically inside its
    own lock, as a backstop against the race between that check and the
    registration, not as the primary guard.

    `initWorkspace`/`initAndRegisterWorkspace` are `createWorkspace`/
    `createAndRegisterWorkspace`'s counterpart for `workspace init`: same
    duplicate-name-checked-before-anything-touches-disk shape, but no
    `mkdir` (the folder already exists with real content) and
    `origin: 'initialized'` instead of `'created'`. Adopting a folder into
    the workspace is a deliberately separate step, `adoptRepoIntoWorkspace`
    — it adopts `<workspaceDir>/<folder>` into the repo cache (unchanged
    `repo/scan.ts`'s `adoptLocalRepo`, registered local-to-the-workspace)
    and appends an `AdoptedEntry`, through the same re-read-fresh-inside-
    the-lock pattern `addRepo`'s tail uses. It is *not* looped over by
    `initWorkspace` itself — same split as `createWorkspace`/`addRepo`, so
    a caller (the CLI's `workspace init`) can run one call per selected
    folder concurrently (`runConcurrently`, the same live-dashboard
    pattern `--repo a --repo b ...` already uses) rather than this module
    doing its own batching.

    `removeRepo` skips the git-worktree-removal step entirely for a
    `kind: 'adopted'` entry — there's no worktree relationship to the
    folder to clean up, it's just dropped from the manifest/
    `.code-workspace` like any other entry. `removeWorkspace` checks
    `manifest.origin` after removing every entry: for `'initialized'`, it
    deletes only the two bookkeeping files it created
    (`spork.workspace.json`, the `.code-workspace` file) and returns —
    never the directory, never anything inside it, since that directory
    is the user's own pre-existing folder, not something spork created.
    `RemoveWorkspaceOptions.keepFiles` is unaffected by any of this — it's
    still an outer, unconditional "touch nothing at all" check that short-
    circuits before either path runs.

    `addRepo`/`removeRepo` are where the shared-branch-per-workspace and per-repo-locking pieces from
    `git`/`repo` actually get used together: `addRepo` gives every repo in a
    workspace the identical branch (the workspace's own name, verbatim —
    see the design doc), rejects adding the same repo twice upfront, and
    turns `addWorktree`'s `isBranchExistsError`/`isWorktreeCollisionError`
    into a clear `SporkError` when the branch is checked out elsewhere
    right now — the one case `addWorktree`'s own reuse-if-exists logic
    can't resolve on its own. `addRepo` also initializes submodules if the worktree
    has any, after the repo-cache lock is released; a submodule-init
    failure produces a warning in the returned `AddRepoResult`, not a
    thrown error — the worktree is still registered. `addRepo`'s `source`
    is resolved local-then-global-then-raw (`resolveScopedRepoAlias`), and
    its alias registers to the workspace's *local* registry by default
    (`AddRepoOptions.global` opts into the shared one instead) — the
    result's `aliasScope` says which happened.
    `addRepo`/`removeRepo`/`reconcileWorkspace` all push their manifest
    mutation through `withFileLock` around the manifest path, re-reading it
    fresh from inside the lock rather than reusing an earlier read — several
    `addRepo` calls run concurrently against the same workspace (`workspace
    create --repo a --repo b ...`, or the interactive picker, both via
    `@spork/task-runner`), so without this, two concurrent writers reading
    the same pre-mutation snapshot would silently overwrite one another.

- `src/registry/registry.ts` — `~/.spork/workspaces.json`: registers/lists/
  unregisters workspaces by name, and `resolveWorkspaceDir`, which is how CLI
  commands accept either a registered workspace name or a raw directory path.
  The registry is treated as an index, not a source of truth — `listWorkspaces`
  drops (and persists the removal of) any entry whose manifest no longer
  exists on disk rather than trusting stale state. Every write (register,
  unregister, and the self-heal above) goes through `withFileLock` around
  the registry path, re-reading fresh inside the lock — same reasoning as
  `workspace.ts`'s manifest locking.
- `src/registry/repoRegistry.ts` — `~/.spork/repos.json`: the same
  index-not-source-of-truth pattern (and the same `withFileLock`-around-
  every-write treatment) as above, but for repo *sources* rather than
  workspaces — `alias → source`, so a repo you've already cloned once
  can be referred to by a short name instead of its full clone URL next
  time. `resolveRepoAlias` is the alias-or-raw-source lookup `addRepoSource`
  (below) and the CLI use; `listRepoAliases` self-heals against
  `repoCacheExists` the same way `listWorkspaces` self-heals against
  `manifestPath` existing.
  - The registry is two-tier: this same file's functions work identically
    against a workspace-local registry (`localRepoRegistryPath(workspaceDir)`
    → `spork.repos.json`, sitting next to that workspace's manifest) — they're
    already parameterized by an arbitrary `registryPath`, nothing about them
    assumes global. `resolveScopedRepoAlias` composes the two: local match
    wins, then global, then the raw input — same precedent as node_modules
    resolution.
  - `workspace/manifest.ts`'s `findEnclosingWorkspaceDir` (walks up from a
    directory for a `spork.workspace.json`, like git's `.git` walk) is what
    lets the standalone `spork repo` CLI commands default to local scope when
    run from inside a workspace. Nothing else needs it — every `workspace`
    command already knows its target by name.

`src/index.ts` is the only import path the rest of the repo (`packages/cli`)
may use — it re-exports the workspace lifecycle API, both registries'
APIs, `SporkError`, and the `~/.spork` path constants. Everything else here
is an implementation detail.

## Testing

`yarn test` (vitest, ≥80% coverage enforced). All `src/git/*` tests mock
`execGit`/`node:child_process` rather than spawning real git processes — see
[../../CONTRIBUTING.md](../../CONTRIBUTING.md).
