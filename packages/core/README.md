# @spork/core

Domain logic for spork: everything the `spork` CLI needs to manage git-worktree
workspaces, with no CLI concerns (parsing, colored output) in it. See
[docs/plans/0001-worktree-workspace-architecture.md](../../docs/plans/0001-worktree-workspace-architecture.md)
for the design this package implements.

## Structure

- `src/git/` — a thin wrapper around invoking the `git` CLI.
  - `exec.ts` — the single spawn point (`execGit`); every other module here goes
    through it, and it's the seam unit tests mock instead of spawning real `git`
    processes.
  - `clone.ts` — bare-clone creation, fetching, and ref resolution against a
    shared repo cache.
  - `worktree.ts` — worktree add/remove/prune/list, always creating a new
    spork-owned local branch per worktree (never reusing the requested ref
    directly — see the design doc for why), plus `isWorktreeCollisionError` to
    recognize git's "ref already checked out elsewhere" failure.
  - `status.ts` — local-only worktree status (branch + dirty file count, no
    fetch).
  - `submodule.ts` — `hasSubmodules` (checks for a `.gitmodules` file) and
    `initSubmodules` (`git submodule update --init --recursive`), since
    `worktree add` never initializes submodules on its own.
- `src/repo/` — the shared repo cache each workspace's worktrees are created from.
  - `cache.ts` — derives a stable cache id/path from a repo source and ensures
    a bare clone of it exists (`ensureRepoCache`), fetching to refresh refs if
    it's already cached rather than re-cloning.
  - `lock.ts` — `withRepoLock`, an exclusive lock (via `proper-lockfile`) around
    mutating a repo cache, since the cache is shared across workspaces and
    concurrent `spork` invocations are expected, not exceptional.
- `src/util/` — `slugify` (filesystem/branch-name-safe strings) and
  `repoShortName` (the repo's short name out of a source URL/path).
- `src/config/paths.ts` — spork's local state locations (`~/.spork/repos`,
  `~/.spork/workspaces.json`).
- `src/errors.ts` — `SporkError`, the one error type used for user-facing
  domain failures (a naming collision, a missing entry) as opposed to bugs.
- `src/workspace/` — the workspace lifecycle built on top of `git`/`repo`.
  - `manifest.ts` — the `spork.workspace.json` schema and its read/write.
  - `codeWorkspace.ts` — generates the workspace's `.code-workspace` file from
    its manifest.
  - `workspace.ts` — orchestration: `createWorkspace`, `addRepo`, `removeRepo`,
    `removeWorkspace`, `getWorkspaceStatus`, and `reconcileWorkspace` (pruning
    stale git worktree metadata and dropping manifest entries for folders
    deleted by hand — called before every other operation here). This is
    where the unique-local-branch-per-worktree and per-repo-locking pieces
    from `git`/`repo` actually get used together. `addRepo` also initializes
    submodules if the worktree has any, after the repo-cache lock is
    released; a submodule-init failure produces a warning in the returned
    `AddRepoResult`, not a thrown error — the worktree is still registered.

- `src/registry/registry.ts` — `~/.spork/workspaces.json`: registers/lists/
  unregisters workspaces by name, and `resolveWorkspaceDir`, which is how CLI
  commands accept either a registered workspace name or a raw directory path.
  The registry is treated as an index, not a source of truth — `listWorkspaces`
  drops (and persists the removal of) any entry whose manifest no longer
  exists on disk rather than trusting stale state.

`src/index.ts` is the only import path the rest of the repo (`packages/cli`)
may use — it re-exports the workspace lifecycle API, the registry API,
`SporkError`, and the `~/.spork` path constants. Everything else here is an
implementation detail.

## Testing

`yarn test` (vitest, ≥80% coverage enforced). All `src/git/*` tests mock
`execGit`/`node:child_process` rather than spawning real git processes — see
[../../CONTRIBUTING.md](../../CONTRIBUTING.md).
