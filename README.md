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

> **Status**: v1 command surface implemented. See
> [docs/plans/0001-worktree-workspace-architecture.md](docs/plans/0001-worktree-workspace-architecture.md)
> for the design.

```sh
spork workspace create demo
spork workspace add-repo demo git@github.com:acme/widgets.git --branch main
spork workspace add-repo demo git@github.com:acme/gadgets.git
spork workspace status demo
spork workspace open demo
spork workspace list
spork workspace remove-repo demo gadgets
spork workspace remove demo
```

Every repo you add is cached once (`~/.spork/repos/`) and given a short
alias, so the next workspace that needs the same repo doesn't need the full
clone URL again:

```sh
spork repo add git@github.com:acme/widgets.git   # -> "widgets" (default alias)
spork repo list
spork workspace create demo2 --repo widgets       # by alias, repeatable
spork repo remove widgets                         # refuses while any workspace still uses it
```

Aliases are two-tier — **local to a workspace by default, global as an
opt-in** — so two different workspaces can give the same short name to two
different repos without colliding:

```sh
spork workspace add-repo demo git@github.com:acme/widgets.git         # alias "widgets", local to demo
spork workspace add-repo demo git@github.com:acme/widgets.git --global # same, but shared across every workspace

spork repo add git@github.com:acme/gadgets.git            # standalone: local if run inside a workspace, else global
spork repo add git@github.com:acme/gadgets.git --local     # force local (must be inside a workspace)
spork repo list                                            # merged view, local + global, tagged
```

Already have a folder of clones lying around (`~/code`, `~/src`, ...)? `spork
repo scan` adopts every repo in it in one pass — each one is cloned into
spork's managed cache from its existing local checkout (fast, hardlinked)
rather than the network, so you don't have to retype URLs by hand:

```sh
spork repo scan ~/code
spork repo list
```

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
