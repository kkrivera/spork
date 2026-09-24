# @spork/core — agent context

Domain logic only. No `commander`, no color/output formatting, no `process.exit` —
that all belongs in `packages/cli`. `src/index.ts` is this package's only public
surface; nothing in this repo should import from `src/*` paths directly.

## `src/git`

- `exec.ts`'s `execGit` is the *only* place a subprocess gets spawned. Every
  other function in `src/git` (and everything built on top of it later) must
  call through it rather than importing `node:child_process` itself — that's
  what keeps the rest of the codebase mockable in unit tests.
- Worktrees are always created on a **new local branch** spork owns
  (`spork/<workspace-slug>/<folder-slug>`), never by checking out the requested
  ref directly. Don't "simplify" this by passing the ref straight to
  `worktree add` — it will collide the moment the same repo+branch is added to
  a second workspace. See
  [docs/plans/0001-worktree-workspace-architecture.md](../../docs/plans/0001-worktree-workspace-architecture.md).

## `src/repo`

`ensureRepoCache` (clone-or-fetch) and any worktree mutation against the same
cache path must be called from inside `withRepoLock` by the caller — `cache.ts`
itself doesn't lock, it just does the filesystem/git work. Don't call
`cloneBare`/`fetchAll` directly outside the lock from orchestration code.

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

## `src/workspace`

`workspace.ts` is the only place the `git`/`repo` layers get combined — keep it
that way rather than having e.g. a CLI command call `addWorktree` directly.
Every function that reads a manifest for anything other than a pure display
purpose should go through `reconcileWorkspace` first (see `addRepo`/`removeRepo`
for the pattern), not call `readManifest` directly — that's what keeps stale
worktrees/folders from causing confusing failures later.

## Tests

Unit tests only for now — mock `execGit` (or `node:child_process` for
`exec.ts`'s own tests), don't spawn real git processes. See root
[CONTRIBUTING.md](../../CONTRIBUTING.md) for the coverage bar (≥80%) and the
rationale for deferring subprocess-driven integration tests.
