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
  the outcomes; don't reimplement this zipping per command.
- `src/commands/workspace/` — one file per `spork workspace <verb>`
  subcommand (`create`, `add-repo`, `remove-repo`, `remove`, `list`,
  `status`, `open`), each exporting a plain `run<Verb>` function (the
  testable logic) and a `register<Verb>Command` that wires it to commander
  and prints the result. `add-repo` (and `create --repo`) register the
  repo's alias locally to the workspace by default, `--global` opts into
  the shared registry instead — `printAddRepoResult` always shows which one
  happened (`(alias: local)`/`(alias: global)`), plus whether submodules
  were initialized or a warning if that failed (the add itself still
  succeeds — see `AddRepoResult` in `@spork/core`). `add-repo` runs its
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
  doc). `index.ts` in this folder registers them all under the `workspace`
  parent command. See
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
