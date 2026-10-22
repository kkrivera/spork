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

## Installing

On macOS or Linux, install `spork` via Homebrew (see
[docs/plans/0003-homebrew-distribution.md](docs/plans/0003-homebrew-distribution.md)):

```sh
brew tap kkrivera/spork https://github.com/kkrivera/spork
brew install spork
```

This only installs the `spork` CLI — `spork-mcp` has no formula (it's a
backend an agent launches, not a tool you run by hand) and is only
available as a prebuilt binary below.

### Installing a prebuilt binary

Every tagged release publishes standalone `spork` and `spork-mcp` binaries
for macOS (arm64 + x64), Windows (x64), and Linux (x64) — no Node.js
required — to that release's
[GitHub Releases](../../releases) page. Download the archive for your
platform, extract it, and put `spork` (or `spork-mcp`) on your `PATH`.

> **macOS note**: until a Developer ID certificate is in place (see
> [docs/RELEASING.md](docs/RELEASING.md)), these binaries are only ad-hoc
> signed. The first time you run one, macOS Gatekeeper will block it —
> right-click the binary → **Open** → confirm, or run
> `xattr -d com.apple.quarantine <path-to-binary>`. This doesn't apply to
> the Homebrew install above — `brew`'s own download never triggers
> Gatekeeper's quarantine check in the first place.

```sh
spork workspace create demo
spork workspace add-repo git@github.com:acme/widgets.git --workspace demo --branch main
spork workspace add-repo git@github.com:acme/gadgets.git --workspace demo
spork workspace status demo
spork workspace open demo
spork workspace list
spork workspace exec "npm run dev" --workspace demo
spork workspace remove-repo gadgets --workspace demo
spork workspace remove demo
```

Already have a folder of repos cloned yourself (not spork worktrees) and
just want spork to treat it as a workspace, as-is? `cd` into it and run
`workspace init` instead of `create` — it scans one level deep for git
repos, lets you pick which join, and wires them in exactly as they
already sit on disk. Unlike every other way of populating a workspace,
`init` **never creates a worktree and never touches a branch** — your
existing checkouts (and whatever they're currently on) are left
completely alone, and `workspace remove` on one of these only ever
deletes spork's own bookkeeping files, never your folders:

```sh
cd ~/code/some-project   # already has api/, web/, infra/ cloned inside it
spork workspace init some-project   # pick which of api/web/infra join
spork workspace status some-project
spork workspace remove some-project   # drops spork.workspace.json + .code-workspace only
```

Set `SPORK_WORKSPACE_DIR` to change `workspace create`'s default parent
directory (otherwise cwd) — an explicit `--dir` always overrides it. This
is the first of spork's `SPORK_*` environment variables; more may be added
over time.

`--workspace`/`-w` (and the matching positional on `status`/`open`/
`remove`) is optional everywhere above — omit it and spork uses the
workspace you're already `cd`'d into, or offers a picker if you're not
inside one. `add-repo`/`remove-repo` go a step further: omit the repo
entirely and pick from a list instead (registered repos to add, or the
workspace's current repos to remove).

Every repo you add is cached once (`~/.spork/repos/`) and given a short
alias, so the next workspace that needs the same repo doesn't need the full
clone URL again:

```sh
spork repo add git@github.com:acme/widgets.git   # -> "widgets" (default alias)
spork repo list
spork workspace create demo2 --repo widgets       # by alias, repeatable
spork repo remove widgets gadgets                 # several at once
spork repo remove                                 # omit entirely: multi-select from every registered alias
```

If a repo you're removing still has a real worktree checked out somewhere, `repo remove` warns and lists exactly which workspaces/folders will also be removed before doing anything (`--yes` skips the prompt) — it doesn't just refuse. A folder a workspace merely *adopted* (`workspace init`, not a worktree) is never affected either way.

`repo remove` is always global — there's no `--local` form of it. A workspace's own local alias (and the worktree behind it, if any) is removed with `spork workspace remove-repo` instead.

Leave off `--repo` entirely in a real terminal and `workspace create` offers
a fuzzy-searchable multi-select of every repo you already know about instead
of starting empty — type to narrow, space to toggle, Ctrl+A to select/
deselect everything filtered, Enter to confirm. It then asks whether to open
the new workspace right away, and with what — VS Code, or Claude (launched
right at the workspace directory). In CI or a script (no TTY), both
prompts are skipped — it falls back to creating an empty workspace and
leaves opening it to you, exactly like today.

`spork workspace open` offers the same choice whenever `--with <code|claude>`
is omitted:

```sh
spork workspace open demo               # pick VS Code or Claude interactively
spork workspace open demo --with claude # skip the prompt
```

Aliases are two-tier — **local to a workspace by default, global as an
opt-in** — so two different workspaces can give the same short name to two
different repos without colliding:

```sh
spork workspace add-repo git@github.com:acme/widgets.git --workspace demo           # alias "widgets", local to demo
spork workspace add-repo git@github.com:acme/widgets.git --workspace demo --global  # same, but shared across every workspace

spork repo add git@github.com:acme/gadgets.git            # standalone: local if run inside a workspace, else global
spork repo add git@github.com:acme/gadgets.git --local     # force local (must be inside a workspace)
spork repo list                                            # merged view, local + global, tagged
```

Already have a folder of clones lying around (`~/code`, `~/src`, ...)? `spork
repo scan` adopts every repo in it in one pass — each one is cloned into
spork's managed cache from its existing local checkout (fast, hardlinked)
rather than the network, so you don't have to retype URLs by hand. The
directory argument is optional and defaults to the current directory:

```sh
spork repo scan ~/code
cd ~/code && spork repo scan   # same thing
spork repo list
```

## Repository layout

- [packages/core](packages/core) — domain logic: git worktree management, workspace
  manifests, the `.code-workspace` generator, the workspace registry.
- [packages/cli](packages/cli) — the `spork` command-line interface, built on `core`.
- [packages/task-runner](packages/task-runner) — runs concurrent tasks with a
  live terminal dashboard (used by `repo scan`, `repo add`, `workspace
  add-repo`/`create --repo`, and `workspace status`).
- [packages/prompts](packages/prompts) — interactive terminal prompts: the
  fuzzy select and the yes/no confirm `workspace create` uses above.
- [packages/mcp](packages/mcp) — an MCP server exposing `core`'s operations as
  tools, so an agent can drive spork directly instead of through the CLI.
- [tools/readme-sync](tools/readme-sync) — the CI check that keeps module READMEs honest.
- [tools/release](tools/release) — bumps every package's version in lockstep;
  run as a GitHub Action (see [docs/RELEASING.md](docs/RELEASING.md)).
- [tools/package-binary](tools/package-binary) — builds/signs the standalone
  binaries described above; also run as a GitHub Action.
- [tools/homebrew-formula](tools/homebrew-formula) — regenerates
  [Formula/spork.rb](Formula/spork.rb) from each release; also run as a
  GitHub Action.
- [Formula](Formula) — the Homebrew formula installed above. Generated, not
  hand-edited — see `tools/homebrew-formula`.
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

`vitest.workspace.ts` lists the actual test projects (`packages/*`, `tools/*`);
`vitest.config.ts` alongside it holds the coverage settings that govern the one
merged report `yarn test` produces across all of them — each project's own
`vitest.config.ts` still governs its *own* standalone run (`cd packages/core &&
yarn test`), but only the root config's `include`/`exclude` apply once everything
is combined, so that's the one to touch if the merged report ever needs
adjusting.

A top-level `workspaces/` directory, if you have one, is a personal scratch
space for `spork workspace create`'s own output — fully ignored by git, ESLint,
and Vitest (including its coverage report), regardless of what ends up in it.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.
