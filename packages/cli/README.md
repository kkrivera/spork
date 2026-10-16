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
- `src/commands/workspace/` — one file per `spork workspace <verb>`
  subcommand (`create`, `add-repo`, `remove-repo`, `remove`, `list`,
  `status`, `open`), each exporting a plain `run<Verb>` function (the
  testable logic) and a `register<Verb>Command` that wires it to commander
  and prints the result. `add-repo` (and `create --repo`) register the
  repo's alias locally to the workspace by default, `--global` opts into
  the shared registry instead — `printAddRepoResult` always shows which one
  happened (`(alias: local)`/`(alias: global)`), whether an existing branch
  was reused instead of creating a fresh one (`AddRepoResult.reusedExistingBranch`
  — e.g. recreating a workspace that touched this repo before), plus
  whether submodules were initialized or a warning if that failed (the add
  itself still succeeds — see `AddRepoResult` in `@spork/core`). `add-repo` runs its
  single `addRepo` call through `runConcurrently` for a live spinner, and
  re-throws the raw error on failure (preserving the usual propagate-to-
  the-top-level-handler contract) rather than reporting it the way a batch
  command does. `create --repo <a> --repo <b> ...` goes a level further:
  every `--repo` is its own concurrent `runConcurrently` item calling
  `addRepo` directly (not through `add-repo`'s own single-item wrapper,
  which would otherwise nest one dashboard per repo) — every outcome gets
  printed, and if any failed or was cancelled, `registerCreateCommand`
  throws *after* printing them all, so the process still exits non-zero
  even though a failure no longer stops the others (a deliberate change
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
  core function just for this. `index.ts` in this folder registers them
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
