# Changelog

What changed in each spork release, newest first. Install or upgrade with
`brew upgrade spork`, or download from the
[releases page](https://github.com/kkrivera/spork/releases).

## [1.2.0] - 2026-11-02

### Changed

- core: fetch only the ref a new worktree starts from
- core: optionally fast-forward a pushed workspace branch before checkout
- cli: ask to start from an already-pushed workspace branch

## [1.1.0] - 2026-10-22

### Added

- add status badge
- cli: let a single repo add prompt for credentials in a terminal
- core: generate workspace-root AGENTS.md and CLAUDE.md
- cli: add --no-agent-files to workspace create and init

### Changed

- cli: workspace create picks repos before creating the workspace
- core: run git with prompts off by default, with auth-failure guidance
- homebrew: install spork-mcp alongside spork from the same formula

### Removed

- remove readme line

### Documentation

- docs: lead the README with install steps and a quick start
- docs: add Claude Code MCP setup steps for manual installs
- docs: make the README's usage sections easier to scan

### Maintenance

- test: check cli/mcp version against package.json, not a literal

## [1.0.0] - 2026-10-22

### Added

- Add root scaffold: yarn workspaces, TS project references, CI, docs/skills conventions
- Add core git wrapper: bare clone, unique-branch worktrees, local status
- Add core repo cache and locking
- Add core workspace manifest, .code-workspace generation, and orchestration
- Add core workspace registry (~/.spork/workspaces.json)
- Add cli package scaffold, commander wiring, and color/format output layer
- Add v1 CLI commands and fix a repo-cache/locking bug found via smoke test
- Add tools/readme-sync CI check, completing the v1 implementation slice
- Add add-repo workflow diagram
- Add repo alias registry (~/.spork/repos.json)
- Add repo/repos.ts: addRepoSource + removeRepoSource service layer
- Add addRepoSourceOrAlias for the upcoming top-level repo add command
- Add spork repo add/list/remove CLI commands
- Add create --repo, share result-printing, and fix a test-typing gap
- Add local-vs-global repo alias primitives (path + cwd-walk + scoped resolve)
- Add --global/--local to repo add/remove with a context-sensitive default
- Add --global opt-in to workspace add-repo / create --repo
- Add git remote get-url/set-url primitives
- Add repo/scan.ts: bulk-adopt a folder of existing local clones
- Add spork repo scan <directory> CLI command
- Add primitives to read/correct a repo cache's default branch
- Add @spork/task-runner: concurrent tasks with a live dashboard
- task-runner: add FunctionTask alongside ProcessTask
- Add concurrentTasks.ts: adapt task-runner for spork's own commands
- Scaffold @spork/prompts: interactive CLI prompts package
- prompts: add fuzzyMatch, a subsequence matcher with word-boundary scoring
- prompts: add the pure key translation and select state reducer
- prompts: add the pure frame renderer
- prompts: add the terminal driver and public select() entry
- prompts: add README and CLAUDE.md
- prompts: add confirm(), a yes/no prompt
- workspace create: offer to open the new workspace in VS Code
- mcp: scaffold @spork/mcp package
- core: add createAndRegisterWorkspace/removeAndUnregisterWorkspace
- cli/mcp: add SEA entry points for the packaged binaries
- tools/release: add bump-version script
- tools/package-binary: add SEA build + macOS signing scripts
- core: add workspace init (adopt an existing folder in place)
- cli: add `spork workspace init <name>`
- cli: add SPORK_WORKSPACE_DIR, the first SPORK_* env var
- tools/package-binary: add real cross-compilation support
- cli: offer launching with Claude, not just VS Code
- Add Homebrew distribution for spork

### Changed

- Initial commit
- Initialize git submodules when adding a repo to a workspace
- Wire workspace.ts's addRepo through the repo alias registry
- Extract shared repo-removal logic; add removeLocalRepoAlias
- workspace.ts's addRepo: scoped resolution + local-by-default alias registration
- repo list: merged local+global view with a SCOPE column
- Document local/global repo scoping; verify end-to-end
- ensureRepoCache: optional cloneFrom for a fresh clone
- addRepoSource: cloneFrom + correctOriginTo for fast local clones
- Document spork repo scan; verify end-to-end with real repos
- architecture diagram update
- Correct a scanned repo's cache HEAD to its real default branch
- Prefix the repo cache id with its owner/org when derivable
- spork repo scan: default directory to cwd when omitted
- Export adoptLocalRepo: the per-repo step inside scanAndAddRepos
- Wire repo scan into task-runner's concurrent live dashboard
- concurrentTasks: preserve the raw thrown error, not just a string
- Wire repo add, workspace add-repo, and create --repo into task-runner
- Wire workspace status into task-runner's live spinner
- task-runner: give every task pane a fixed, equal share of terminal height
- cli: thread TaskReporter through runConcurrently so panes show output
- Wire @spork/prompts into workspace create's interactive repo picker
- workspace create: treat --dir as a parent, not the exact target
- addRepo: one shared branch per workspace, verbatim (no spork/ prefix)
- addWorktree: reuse an existing branch instead of always failing
- fetchAll: actually configure a fetch refspec (it never had one)
- workspace open: pick from a list when no name is given
- workspace commands: make the workspace argument optional, confirm destructive ones
- add-repo: default to picking from the registry, auto-detect workspace from cwd
- remove-repo: --workspace flag, variadic folders, multi-select, concurrent
- workspace exec: run an arbitrary command at a workspace's root
- commandExecutor: forward signals to the child, wait for it to actually exit
- commandExecutor: run command through \$SHELL, not Node's hardcoded /bin/sh
- mcp: register the first round of spork tools
- core: exclude adopted entries from findRepoUsages, add workspaceDir
- cli: repo remove cascades through workspace worktrees, global-only
- package-binary: silence esbuild's harmless empty-import-meta warning
- package-binary: ad-hoc sign darwin binaries right after injection

### Fixed

- core: fix lost manifest/registry entries under concurrent writes

### Removed

- remove: remove multiple workspaces concurrently, with live output

### Documentation

- docs: document workspace init and its adopted-entry/origin design
- docs: document cross-compiled binary builds, drop resolved macos-13 risk
- docs: document the VS Code/Claude launch picker

### Maintenance

- gitignore: ignore workspaces/ at the repo root
- eslint: ignore workspaces/ at the repo root
- vitest: fully exclude workspaces/ from coverage and the file watcher
- release: add binary-release GitHub Actions workflows and docs
- release: build every binary target from 2 jobs instead of 4
- release: push bump tag with a GitHub App token

[1.2.0]: https://github.com/kkrivera/spork/releases/tag/v1.2.0
[1.1.0]: https://github.com/kkrivera/spork/releases/tag/v1.1.0
[1.0.0]: https://github.com/kkrivera/spork/releases/tag/v1.0.0
