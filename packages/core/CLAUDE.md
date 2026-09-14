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

## Tests

Unit tests only for now — mock `execGit` (or `node:child_process` for
`exec.ts`'s own tests), don't spawn real git processes. See root
[CONTRIBUTING.md](../../CONTRIBUTING.md) for the coverage bar (≥80%) and the
rationale for deferring subprocess-driven integration tests.
