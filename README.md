# spork

`spork` is a CLI that turns a set of independent, unrelated git repositories into a
single local **workspace** built from isolated `git worktree` checkouts — a "mini
monorepo" you can open and work across in one place, without ever merging the repos'
histories.

A workspace is:

- a folder on disk containing one subfolder per repo (each an isolated `git worktree`
  checkout of a chosen ref),
- a generated VS Code `.code-workspace` file so you can open every repo as one
  multi-root editor session,
- and a `spork.workspace.json` manifest describing exactly what's in it, so the
  workspace's layout is reproducible.

> **Status**: early — the v1 command surface (`create` / `add-repo` / `remove-repo` /
> `remove` / `list` / `status` / `open`) is under active development. See
> [docs/plans/0001-worktree-workspace-architecture.md](docs/plans/0001-worktree-workspace-architecture.md)
> for the design.

## Repository layout

- [packages/core](packages/core) — domain logic: git worktree management, workspace
  manifests, the `.code-workspace` generator, the workspace registry.
- [packages/cli](packages/cli) — the `spork` command-line interface, built on `core`.
- [tools/readme-sync](tools/readme-sync) — the CI check that keeps module READMEs honest.
- [docs/plans](docs/plans) — durable design docs, reviewed like code.
- [.claude/skills](.claude/skills) — Claude Code skills used to maintain this repo.

## Development

This is a [yarn workspaces](https://yarnpkg.com/features/workspaces) monorepo, written
in TypeScript.

```sh
corepack enable
yarn install
yarn build          # tsc -b, via TypeScript project references
yarn lint
yarn test           # vitest, ≥80% coverage enforced
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.
