# spork — agent context

`spork` is a TypeScript CLI that manages git-worktree-based "workspaces" spanning
multiple, otherwise-unrelated repos. See [README.md](README.md) for the product
pitch and [docs/plans/0001-worktree-workspace-architecture.md](docs/plans/0001-worktree-workspace-architecture.md)
for the full design and its rationale — read that before changing anything under
`packages/core/src/git` or `packages/core/src/workspace`.

## Layout

- `packages/core` — domain logic (git wrapper, repo cache/locking, manifest,
  workspace orchestration, registry). `cli` may only import `core`'s public
  `src/index.ts` exports, never reach into `core/src/*` directly — this is enforced
  by TypeScript project references, not just convention.
- `packages/cli` — the `spork` binary: command parsing (commander) and output
  formatting (color/no-color aware). Business logic belongs in `core`, not here.
- `tools/readme-sync` — CI script; does not generate README content, only checks
  that a module's README.md changed alongside its source.
- `docs/plans` — durable, reviewed design docs. Write one before a non-trivial
  architectural change; update it if the change reshapes the design.
- `.claude/skills` — skills for maintaining this repo (see below).

## Conventions to follow

- **Small, focused commits/PRs.** One concern per commit. This repo's own history
  is meant to be reviewable in small chunks — don't bundle unrelated changes.
- **File-size limits are enforced by ESLint** (`max-lines: 300`, `max-lines-per-function: 50`,
  see [eslint.config.js](eslint.config.js)). If a file is hitting the limit, split it
  along a real seam instead of disabling the rule.
- **Every new or changed feature needs unit tests**, targeting ≥80% coverage
  (enforced by vitest's coverage thresholds in CI). Tests mock `child_process`/exec —
  do not spawn real `git` or `code` processes in unit tests; that kind of
  subprocess-driven integration testing is deferred to a later phase.
- **Update the module's README.md whenever its source changes.** CI
  (`tools/readme-sync/check.ts`) fails a diff that touches a module's source without
  touching its README. Use the `readme-sync` skill below to draft the update.
- **New package? Use the `new-package` skill** below rather than hand-rolling the
  boilerplate, so it stays consistent with the rest of the repo.

## Skills

- [.claude/skills/readme-sync](.claude/skills/readme-sync/SKILL.md) — regenerate a
  module's README.md from its current source.
- [.claude/skills/new-package](.claude/skills/new-package/SKILL.md) — scaffold a new
  `packages/<name>` package with the standard boilerplate.
