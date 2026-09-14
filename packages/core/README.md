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

More modules (repo cache/locking, workspace manifest/orchestration, registry)
land here as the rest of the v1 slice is implemented — see the design doc's
implementation order.

## Testing

`yarn test` (vitest, ≥80% coverage enforced). All `src/git/*` tests mock
`execGit`/`node:child_process` rather than spawning real git processes — see
[../../CONTRIBUTING.md](../../CONTRIBUTING.md).
