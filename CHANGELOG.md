# Changelog

What changed in each spork release, newest first. Install or upgrade with
`brew upgrade spork`, or download from the
[releases page](https://github.com/kkrivera/spork/releases).

## [1.2.0] - 2026-11-02

### Added

- `workspace create` and `workspace add-repo` check whether the workspace's
  branch is already on each repo's remote (pushed from an earlier
  workspace, say) and ask once whether to start from it. spork only
  fast-forwards to the remote's copy; if your local branch has commits the
  remote doesn't, it keeps yours and warns you.
- `--from-remote-branch` and `--no-from-remote-branch` answer that
  question up front. Without a terminal, spork starts fresh and prints
  which flag to pass.

### Fixed

- Adding a repo no longer fails with "refusing to fetch into branch …
  checked out at …" once any workspace's branch for that repo has been
  pushed. spork now fetches only the branch a new checkout starts from.
- A plain `git pull` inside a workspace folder no longer hits the same
  refusal.

## [1.1.0] - 2026-10-22

### Added

- Every workspace gets an `AGENTS.md` and a `CLAUDE.md` at its root, so a
  coding agent started there knows each folder is its own repo with its
  own rules. spork keeps them up to date as repos are added and removed,
  and only ever rewrites its own section. `--no-agent-files` on
  `workspace create` and `workspace init` skips them.
- `brew install spork` also installs `spork-mcp`, and `brew upgrade spork`
  keeps both current.

### Changed

- git and ssh no longer wait on a passphrase, password or host-key prompt
  that can't be seen (behind the live progress display, or in the MCP
  server). They fail right away with steps to fix it, such as loading
  your key with `ssh-add`.
- `repo add` for a single repo in a terminal can still ask for a
  passphrase or password directly.

### Fixed

- Backing out of `workspace create`'s repo picker no longer leaves an
  empty workspace behind.

## [1.0.0] - 2026-10-22

First release.

### Added

- Workspaces: one folder that combines several independent git repos as
  `git worktree` checkouts, on one branch named after the workspace, with
  a VS Code `.code-workspace` file and a `spork.workspace.json` manifest.
  Each repo is cloned once into `~/.spork/repos` and shared by every
  workspace.
- `workspace create`, `add-repo`, `remove-repo`, `status`, `list`, `open`,
  `exec` and `remove`. `workspace init` turns a folder of existing clones
  into a workspace in place, without touching their branches.
- `repo add`, `list`, `remove` and `scan`, with short aliases for repos,
  local to a workspace by default or shared with `--global`. `repo scan`
  registers every repo in a folder, copying from your local clones instead
  of the network.
- `workspace open` launches VS Code or Claude, and `workspace create`
  offers to.
- Searchable pickers whenever a workspace or repo is left off a command,
  and a confirmation before anything is removed (`--yes` skips it).
- A live progress display when several repos are cloned, fetched or
  removed at once.
- Submodules are initialized when a repo is added.
- `SPORK_WORKSPACE_DIR` sets where new workspaces are created by default.
- `spork-mcp`, an MCP server so Claude Code and other agents can create and
  manage workspaces.
- Standalone binaries for macOS, Linux and Windows, and a Homebrew formula.

[1.2.0]: https://github.com/kkrivera/spork/releases/tag/v1.2.0
[1.1.0]: https://github.com/kkrivera/spork/releases/tag/v1.1.0
[1.0.0]: https://github.com/kkrivera/spork/releases/tag/v1.0.0
