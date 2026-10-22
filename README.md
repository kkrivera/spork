# spork

[![CI](https://github.com/kkrivera/spork/actions/workflows/ci.yml/badge.svg)](https://github.com/kkrivera/spork/actions/workflows/ci.yml)

`spork` is a CLI that combines independent git repositories into one local
**workspace** made of isolated `git worktree` checkouts. It works like a small
monorepo you can open and work across in one place, without merging the repos'
histories.

## Install

### Homebrew (macOS and Linux), recommended

```sh
brew tap kkrivera/spork https://github.com/kkrivera/spork
brew install spork
```

To update later, just run:

```sh
brew upgrade spork
```

#### Use spork from Claude Code (optional)

spork also ships an MCP server, `spork-mcp`, so Claude can create and manage
workspaces for you. Homebrew installs it alongside `spork`. Register it
once:

```sh
claude mcp add --scope user spork -- "$(brew --prefix)/bin/spork-mcp"
```

`brew upgrade spork` keeps it up to date too. A Claude Code session that's
already open keeps using the old version until you restart it.

### Manual download (macOS, Linux, Windows)

1. Open the [latest release](https://github.com/kkrivera/spork/releases/latest)
   and download the `spork` archive for your computer:

   | Your computer | Download |
   | --- | --- |
   | Mac with Apple silicon (M1 or later) | `spork-<version>-darwin-arm64.tar.gz` |
   | Mac with Intel | `spork-<version>-darwin-x64.tar.gz` |
   | Linux (x64) | `spork-<version>-linux-x64.tar.gz` |
   | Windows (x64) | `spork-<version>-win32-x64.zip` |

2. Extract it and move `spork` onto your `PATH`:

   ```sh
   tar -xzf spork-*.tar.gz
   sudo mv spork /usr/local/bin/
   ```

   On Windows, unzip it and put `spork.exe` in a folder on your `PATH`.

3. **macOS only:** the first run is blocked by Gatekeeper, because the
   binaries aren't notarized yet. Clear the download flag once:

   ```sh
   xattr -d com.apple.quarantine /usr/local/bin/spork
   ```

4. Check it worked: `spork --version`.

To update a manual install, repeat these steps with the newer release.

#### Use spork from Claude Code (optional)

spork also ships an MCP server, `spork-mcp`, so Claude can create and manage
workspaces for you.

1. From the same release, download the `spork-mcp` archive for your
   computer: the same names as the table above, starting with `spork-mcp-`
   instead of `spork-` (for example `spork-mcp-<version>-darwin-arm64.tar.gz`).

2. Extract it and move it next to `spork`:

   ```sh
   tar -xzf spork-mcp-*.tar.gz
   sudo mv spork-mcp /usr/local/bin/
   xattr -d com.apple.quarantine /usr/local/bin/spork-mcp   # macOS only
   ```

   On Windows, unzip it and put `spork-mcp.exe` next to `spork.exe`.

3. Register it once with its full path:

   ```sh
   claude mcp add --scope user spork -- /usr/local/bin/spork-mcp
   ```

To update it, download the newer `spork-mcp` archive and replace the file
in step 2. The registration doesn't need to change. A Claude Code session
that's already open keeps using the old version until you restart it.

### Using an SSH key with a passphrase?

Load it into your ssh-agent once, so spork can clone without having to
ask you for the passphrase:

```sh
ssh-add --apple-use-keychain ~/.ssh/id_ed25519   # macOS
ssh-add ~/.ssh/id_ed25519                        # Linux
```

## Quick start

```sh
spork repo add git@github.com:acme/widgets.git   # register a repo once, as "widgets"
spork workspace create demo --repo widgets       # make a workspace with it
spork workspace open demo                        # open it in VS Code or Claude
```

## What's a workspace?

A workspace is a folder containing:

- one subfolder per repo, each an isolated `git worktree` checkout of the ref you chose
- a VS Code `.code-workspace` file that opens every repo in one window
- a `spork.workspace.json` manifest listing what's in it, so the layout is reproducible

The design is in
[docs/plans/0001-worktree-workspace-architecture.md](docs/plans/0001-worktree-workspace-architecture.md).

## Usage

### Workspaces

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

You can leave off `--workspace`/`-w`, or the workspace name on `status`,
`open`, and `remove`. spork then uses the workspace you're in, or shows a
picker if you aren't in one. `add-repo` and `remove-repo` also let you leave
off the repo and pick it from a list.

Run `workspace create` without `--repo` in a terminal and it shows a
searchable list of the repos you've already added. Type to filter, Space to
toggle, Ctrl+A to toggle everything shown, Enter to confirm. It then asks
whether to open the new workspace in VS Code or Claude. In CI or a script,
it skips both questions and creates an empty workspace.

`workspace open` asks the same question unless you pass `--with`:

```sh
spork workspace open demo               # pick VS Code or Claude
spork workspace open demo --with claude # skip the question
```

New workspaces go in the current directory. Set `SPORK_WORKSPACE_DIR` to
use a different default parent directory. `--dir` overrides both.

### Repos and aliases

spork clones each repo once into `~/.spork/repos/` and gives it a short
alias, so later workspaces can use the alias instead of the URL:

```sh
spork repo add git@github.com:acme/widgets.git   # alias "widgets"
spork repo list
spork workspace create demo2 --repo widgets       # by alias, repeatable
spork repo remove widgets gadgets                 # several at once
spork repo remove                                 # pick from a list
```

Aliases are local to a workspace by default, so two workspaces can use the
same short name for different repos. Pass `--global` to share one across
every workspace:

```sh
spork workspace add-repo git@github.com:acme/widgets.git --workspace demo           # alias "widgets", local to demo
spork workspace add-repo git@github.com:acme/widgets.git --workspace demo --global  # shared by every workspace

spork repo add git@github.com:acme/gadgets.git          # local if run inside a workspace, otherwise global
spork repo add git@github.com:acme/gadgets.git --local  # force local (must be inside a workspace)
spork repo list                                          # local and global together, labeled
```

`repo remove` only removes global aliases. To remove a workspace's local
alias, and its worktree if it has one, use `spork workspace remove-repo`.

If a repo you're removing is still checked out as a worktree in some
workspace, `repo remove` lists which workspaces and folders will also be
removed and asks before doing anything. Pass `--yes` to skip the question.
Folders added with `workspace init` (below) are never touched.

### Adding repos you've already cloned

`spork repo scan` registers every repo in a folder in one go. It copies each
one from your local checkout instead of the network, which is fast and saves
retyping URLs. The folder defaults to the current directory:

```sh
spork repo scan ~/code
cd ~/code && spork repo scan   # same thing
spork repo list
```

### Using an existing folder as a workspace

If you already have a folder with repos cloned inside it, `cd` into it and
run `workspace init` instead of `create`. It finds git repos one level down,
lets you pick which to include, and uses them where they are. `init` never
creates a worktree or switches a branch, and `workspace remove` on one of
these workspaces deletes only spork's own files, never your folders:

```sh
cd ~/code/some-project              # already has api/, web/, infra/ inside it
spork workspace init some-project   # pick which of api/web/infra to include
spork workspace status some-project
spork workspace remove some-project # deletes spork.workspace.json and the .code-workspace file only
```

## Repository layout

- [packages/core](packages/core): domain logic, including git worktree
  management, workspace manifests, the `.code-workspace` generator, and the
  workspace registry.
- [packages/cli](packages/cli): the `spork` command-line interface, built on `core`.
- [packages/task-runner](packages/task-runner): runs tasks concurrently with a
  live terminal dashboard (used by `repo scan`, `repo add`, `workspace
  add-repo`, `create --repo`, and `workspace status`).
- [packages/prompts](packages/prompts): the interactive pickers and yes/no
  prompts.
- [packages/mcp](packages/mcp): the `spork-mcp` server, which exposes `core`'s
  operations as MCP tools so an agent can drive spork directly.
- [tools/readme-sync](tools/readme-sync): the CI check that a module's README
  changes along with its source.
- [tools/release](tools/release): bumps every package's version together. Run
  by a GitHub Action, see [docs/RELEASING.md](docs/RELEASING.md).
- [tools/package-binary](tools/package-binary): builds and signs the
  standalone binaries. Also run by a GitHub Action.
- [tools/homebrew-formula](tools/homebrew-formula): regenerates
  [Formula/spork.rb](Formula/spork.rb) for each release. Also run by a GitHub
  Action.
- [Formula](Formula): the Homebrew formula (`spork` and `spork-mcp`).
  Generated, so don't edit it by hand.
- [docs/plans](docs/plans): design docs, reviewed like code.
- [.claude/skills](.claude/skills): Claude Code skills for maintaining this repo.

## Development

This is a TypeScript monorepo using
[yarn workspaces](https://yarnpkg.com/features/workspaces).

```sh
corepack enable
yarn install
yarn build          # tsc -b, via TypeScript project references
yarn lint
yarn test           # vitest, at least 80% coverage required
```

`vitest.workspace.ts` lists the test projects (`packages/*` and `tools/*`).
`yarn test` produces one merged coverage report, and only the root
`vitest.config.ts` controls what that report includes, so edit that file to
change it. Each project's own `vitest.config.ts` applies only when you run
that project's tests by themselves, for example `cd packages/core && yarn test`.

A top-level `workspaces/` folder is ignored by git, ESLint, and Vitest, so
you can use it as scratch space for `spork workspace create`.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.
