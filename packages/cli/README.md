# @spork/cli

The `spork` command-line interface. Wires [@spork/core](../core) up to
`commander` for argument parsing and a small color/output layer — no domain
logic lives here.

## Structure

- `src/index.ts` — the `spork` bin entry. `createProgram()` builds the
  commander program (name/description/version, the `--color`/`--no-color`
  flags); `main()` parses argv and runs it. Guarded so importing this module
  (as tests do) doesn't itself run the CLI.
- `src/output/color.ts` — `createUi`/`resolveColorEnabled`: decides whether
  color is on, in order, from an explicit `--no-color`/`--color` flag, the
  `NO_COLOR` env var, `CI`, then whether stdout is a TTY — and hands back
  `picocolors` color functions that are plain no-op passthroughs when color
  is off. Every command should route text through this rather than coloring
  output directly.
- `src/output/format.ts` — `formatTable`, a plain space-padded table
  renderer (no box drawing) so output stays clean piped or in CI.
- `src/context.ts` — `createAppContext`, building the `{ reposRoot,
  registryPath, repoRegistryPath, ui }` every command needs from
  `@spork/core`'s path constants and the output layer, plus narrowing
  helpers (`workspaceContext`, `repoContext`, `removeRepoSourceContext`)
  that pick out exactly the fields a given `@spork/core` function's context
  parameter needs.
- `src/opener.ts` — `createCodeOpener`, an injectable abstraction around
  shelling out to the `code` CLI (used by `workspace open`), so it's mockable
  in tests and doesn't fail silently if `code` isn't installed.
- `src/commandExecutor.ts` — `createShellExecutor`, an injectable
  abstraction around running an arbitrary command through a real shell
  with `stdio: 'inherit'` (used by `workspace exec`) — the child gets the
  terminal directly (raw output, working Ctrl+C, no capturing/buffering),
  rather than being routed through `@spork/task-runner`'s live dashboard,
  which is built for several short tasks that settle and summarize, not
  one long-running or interactive foreground process.
- `src/confirmDestructive.ts` — `confirmDestructive(message, yes)`: the
  shared yes/no gate every destructive `workspace` command (`remove`,
  `remove-repo`) runs through before acting, even when its target was given
  explicitly rather than picked interactively. `yes: true` (a command's own
  `--yes`/`-y` flag) skips the prompt outright — the escape hatch a
  script/CI run needs. Without it and without a TTY, fails with a clear
  `SporkError` demanding `--yes` rather than silently proceeding with (or
  silently skipping) something destructive; declining the prompt itself
  becomes `SporkError`'s usual `'Cancelled.'`. Defaults to "no" on bare
  Enter, unlike `workspace create`'s open-in-VS-Code confirm — there's no
  safe default to lean toward for something destructive.
- `src/repoScope.ts` — `resolveRepoScope`/`describeRepoScope`: decides which
  repo-alias registry a standalone `repo` command should use. `--global`/
  `--local` are explicit overrides (passing both is an error); with neither,
  the default is context-sensitive — local if the cwd is inside a workspace
  (`@spork/core`'s `findEnclosingWorkspaceDir`, walking up like git's `.git`
  walk), global otherwise. `workspace` commands never use this — they
  already know their target by name, so there's no ambiguity to resolve.
- `src/concurrentTasks.ts` — `runConcurrently(items)`: the one place
  `@spork/task-runner` gets adapted for spork's own commands. Builds one
  `FunctionTask` per named async call, runs them all through `runTasks`
  (the live dashboard), and zips each one's resolved value (or thrown
  error — both captured into outer arrays by index, since `task-runner`'s
  own `TaskResult` stays process-shaped, not generic) back into a
  `{name, value, error, errorMessage, cancelled}` outcome. `error` is the
  *raw* thrown value (re-throw it to preserve a single-item command's
  existing "let it propagate to the top-level handler" contract);
  `errorMessage` is always a plain string, for a batch command that just
  wants to report a reason and move on. Every command below that wants
  concurrent, live-displayed work just builds the `items` list and reads
  the outcomes; don't reimplement this zipping per command. Each item's
  `call` receives its own `TaskReporter` — call `report.log(...)` from
  inside it (before/around the `@spork/core` call) to push a short
  progress line ("cloning/fetching <source>...", etc.) into that item's
  own pane in the live dashboard; none of spork's core functions report
  incremental progress themselves (that would mean threading a reporter
  through `execGit`, out of scope — see `@spork/task-runner`'s README),
  so this one coarse line per item is what actually fills each task's
  equal-height pane while it runs. A `call` that never logs anything just
  shows its header with an empty pane beneath.
- `src/commands/workspace/pickWorkspace.ts` — `pickWorkspaceName`/
  `pickWorkspaceNames`: the shared single-/multi-select picker every
  `workspace <verb>` command below uses when its workspace argument was
  omitted. `pickWorkspaceName` (single) first checks whether `cwd` is
  already inside a registered workspace (`@spork/core`'s
  `findEnclosingWorkspaceDir`, the same convention `repoScope.ts` uses for
  `spork repo`'s local/global default) and, if so, resolves to it directly
  with no prompt at all; otherwise it lists every registered workspace
  (`@spork/core`'s `listWorkspaces`) via `@spork/prompts`' `select()`.
  `pickWorkspaceNames` (multi) has no such auto-detect — picking several is
  the point, so it always offers the full list. `NotInteractiveError` (no
  TTY) becomes a `SporkError` naming the explicit-argument form instead
  (there's no sensible default to fall back to); a real cancel (Esc/
  Ctrl+C) becomes `SporkError('Cancelled.')`. Both resolve to the
  workspace's *name*, not its directory, so a caller still goes through
  `resolveWorkspaceDir` the normal way afterward.
- `src/commands/workspace/addReposBatch.ts` — `addReposToWorkspace`: adds
  several sources to one workspace directory concurrently
  (`runConcurrently`'s live dashboard), calling `@spork/core`'s `addRepo`
  directly rather than through `add-repo`'s own single-item wrapper (which
  would otherwise nest one dashboard per repo). Best-effort, not fail-fast
  — every source is attempted regardless of a sibling's failure. Shared by
  `create --repo a --repo b ...` and `add-repo`'s own no-source,
  pick-from-the-registry flow (see below), so this batch-add/outcome logic
  only lives in one place.
- `src/commands/workspace/` — one file per `spork workspace <verb>`
  subcommand (`create`, `add-repo`, `remove-repo`, `remove`, `list`,
  `status`, `open`, `exec`), each exporting a plain `run<Verb>` function
  (the testable logic) and a `register<Verb>Command` that wires it to
  commander and prints the result. Every subcommand except `create` and
  `list` takes its workspace by name but can omit it — `add-repo`,
  `remove-repo`, `remove`, `status`, `open`, and `exec` all fall back to
  `pickWorkspace.ts`'s
  picker rather than requiring the name up front; `create`'s `name` is the
  *new* workspace being created (nothing to pick from) and `list` takes no
  workspace at all, so neither needed this. `remove` takes its workspaces
  as a variadic `[workspaces...]` and, when none are given, offers a
  *multi*-select instead of a single one, since removing several at once is
  a real use case — and, once confirmed (see below), removes them through
  `runConcurrently` rather than a sequential loop, same live dashboard
  `create --repo a --repo b ...`/`repo scan` already use: each workspace's
  removal only touches its own directory/registry entry (any shared repo
  cache is already lock-protected), so there's nothing requiring one-at-a-
  time ordering, and a plain sequential loop would otherwise buffer every
  result until the whole batch finished instead of showing progress as
  each one completes. `remove-repo` and `add-repo` both take their
  workspace as a `--workspace`/`-w <name>` flag rather than a positional,
  for the same reason: a bare `[workspace] [folder-or-source]` pair can't
  tell "a lone argument is the workspace" from "a lone argument is the
  other thing" apart without guessing, and moving `workspace` to a flag
  sidesteps that rather than trying to resolve it more cleverly.
  `remove-repo` takes its folders as a variadic `[folders...]` and, when
  none are given, offers a multi-select of the resolved workspace's own
  worktrees (mirroring `remove`'s own variadic/multi-select-when-omitted
  shape) — and, once confirmed, removes them through `runConcurrently`
  too, same reasoning as `remove`'s own batch removal (each folder's
  removal only touches its own worktree and the manifest, which
  `@spork/core`'s `removeRepo` already locks). For `add-repo`, omitting
  `[source]` lists every already-registered repo (the same merged
  local+global view `repo list` shows) and offers a multi-select instead
  of requiring a raw source string — the common case
  is adding something already scanned/registered elsewhere, not cloning
  something brand new; `--branch`/`--as` only make sense for one explicit
  source (which ref, what folder name), so passing either without
  `[source]` is a clear error rather than silently applying to every
  picked repo. `remove` and
  `remove-repo` are destructive (they delete worktrees, and `remove`
  deletes the workspace directory too unless `--keep-files`), so both run
  every removal through `confirmDestructive` — *even* when the target was
  given explicitly, not just when picked — with a `--yes`/`-y` flag to skip
  it for scripts/CI; see `confirmDestructive.ts` above for the
  non-interactive failure mode. `add-repo` (and `create --repo`) register the
  repo's alias locally to the workspace by default, `--global` opts into
  the shared registry instead — `printAddRepoResult` always shows which one
  happened (`(alias: local)`/`(alias: global)`), whether an existing branch
  was reused instead of creating a fresh one (`AddRepoResult.reusedExistingBranch`
  — e.g. recreating a workspace that touched this repo before), plus
  whether submodules were initialized or a warning if that failed (the add
  itself still succeeds — see `AddRepoResult` in `@spork/core`). `add-repo`
  with an explicit `[source]` runs its single `addRepo` call through
  `runConcurrently` for a live spinner, and re-throws the raw error on
  failure (preserving the usual propagate-to-the-top-level-handler
  contract) rather than reporting it the way a batch command does; without
  one, it goes through `addReposBatch.ts`'s `addReposToWorkspace` instead
  (see above) for the multi-select batch, printing every outcome and
  throwing afterward if any failed, same as `create --repo <a> --repo <b>
  ...` — which uses that exact same helper, not a separate copy of the
  same logic — every outcome gets printed, and if any failed or was
  cancelled, `registerCreateCommand` throws *after* printing them all, so
  the process still exits non-zero even though a failure no longer stops
  the others (a deliberate change
  from the previous sequential fail-fast behavior — see the architecture
  doc). `create` with no `--repo` at all tries an interactive multi-select
  instead of always creating an empty workspace: it lists known repos the
  same way `repo list` does and, only if there's something to pick from,
  calls `@spork/prompts`' `select()`. `select()` throws
  `NotInteractiveError` when it can't prompt (no TTY — CI, a pipe, a
  script); `resolveRepoSources` catches exactly that and falls back to
  today's non-interactive behavior (empty workspace), while a real cancel
  (`select()` resolving `null`) becomes a thrown `SporkError`, same as
  every other cancelled-prompt path here. After everything else prints
  (repo outcomes or the "no repos" hint), `create` also offers to open the
  new workspace in VS Code via `@spork/prompts`' `confirm()` — the user is
  probably about to start working in it. Same `NotInteractiveError`
  handling as the repo picker (skipped silently, no behavior change, when
  it can't prompt); declining just prints how to open it later
  (`spork workspace open <name>`); confirming reuses the same injectable
  `Opener` (`opener.ts`) `workspace open` uses, so `registerCreateCommand`
  takes one too (`opener: Opener = createCodeOpener()`), for the same
  reason — mockable in tests, no silent failure if `code` isn't installed.
  `status` wraps its (already internally concurrent —
  `getWorkspaceStatus` reads every worktree via its own `Promise.all`)
  status read as a single `runConcurrently` item too, for a live spinner
  instead of a silent wait, rather than exporting a second per-worktree
  core function just for this. `open [workspace]`'s name is optional too,
  same `pickWorkspace.ts` picker as the rest. `exec <command> --workspace
  <name>` runs an arbitrary command at the root of a workspace (not any
  one repo's own worktree — the directory the `.code-workspace` file
  lives in), for things that span the whole workspace rather than one
  repo (a root-level `docker-compose up`, a script that starts every
  service). `command` is a single shell string (supports `&&`/pipes/env
  expansion), run through `commandExecutor.ts`'s injectable
  `CommandExecutor` with inherited stdio rather than
  `runConcurrently`'s dashboard — unlike every other command here, this
  one is typically long-running or interactive, so it gets the real
  terminal directly instead of being tailed into a pane. `--workspace` is
  optional, same `pickWorkspace.ts` picker as every other command (cwd
  auto-detect, then a single-select); `runExec` takes an `onResolved`
  callback fired once the workspace is known but *before* the command
  starts, which `registerExecCommand` uses to print which workspace got
  picked — otherwise there'd be no feedback at all until the command's own
  output appeared. The child's exit code (or `1` if it was killed by a
  signal instead of exiting normally) becomes spork's own exit code, so
  `spork workspace exec "npm test" --workspace x` composes correctly in
  scripts/CI. `index.ts` in this folder registers them
  all under the `workspace` parent command. See
  [docs/plans/0001-worktree-workspace-architecture.md](../../docs/plans/0001-worktree-workspace-architecture.md)
  for the command surface and its rationale.
- `src/commands/repo/` — `spork repo <verb>` (`add`, `list`, `remove`,
  `scan`), same `run<Verb>`/`register<Verb>Command` split. Decoupled from
  any workspace: `repo add <source>` clones/registers an alias directly;
  `repo remove <alias>` refuses if any workspace still references it. Both
  take `--global`/`--local` (see `repoScope.ts`) and print which scope the
  alias landed in or was removed from. `repo list` is the one place that
  doesn't pick a single scope by default — it merges local (if inside a
  workspace) and global entries into one table with a SCOPE column, so a
  shadowed alias is visible rather than a silent surprise; `--global`/
  `--local` narrow it to just one. `repo scan [directory]` bulk-adopts every
  git repo found directly under `directory` (e.g. an existing `~/code`),
  defaulting to the current working directory when omitted — via
  `@spork/core`'s `findGitRepoDirs` + `adoptLocalRepo`, run concurrently
  with a live dashboard through `runConcurrently` (see
  `concurrentTasks.ts` above). Same `--global`/`--local` scope handling as
  `add`; a cancelled or failed adopt is reported as skipped (with
  `'cancelled'` or the captured error as its reason), and prints one line
  per added repo, one per skipped repo, and a final added/skipped count —
  same output shape as before, now concurrent.

## Testing

`yarn test` (vitest, ≥80% coverage enforced). Commands are tested with
`@spork/core` mocked — this package's tests never touch the filesystem or
spawn a subprocess.
