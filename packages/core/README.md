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
  - `cache.ts` also exports `repoCacheExists`, used by the repo registry
    below to tell whether a registered alias's cache is still actually there.
  - `repos.ts` — the service layer over the repo registry:
    - `addRepoSource(ctx, source, { alias? })` — ensure cloned, then
      register/reuse an alias for it. Expects a real source, not an alias.
    - `addRepoSourceOrAlias(ctx, aliasOrSource, { alias? })` — the same, but
      resolves an alias-or-raw-source input first (mirroring
      `resolveWorkspaceDir`'s pattern). This is what the top-level `repo add`
      command uses; `workspace.ts`'s `addRepo` resolves separately instead
      (it needs to fail fast on a folder-name collision *before* touching
      the network, so it can't resolve-and-clone in one step).
    - `removeRepoSource` — deletes a cache and forgets its alias, but
      hard-refuses via `findRepoUsages` if any workspace still has a
      worktree checked out from it — no force-override, since that worktree
      is a live pointer into the cache's object store.
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
- `src/registry/repoRegistry.ts` — `~/.spork/repos.json`: the same
  index-not-source-of-truth pattern as above, but for repo *sources* rather
  than workspaces — `alias → source`, so a repo you've already cloned once
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
