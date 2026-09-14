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
  registryPath, ui }` every command needs from `@spork/core`'s path constants
  and the output layer.
- `src/opener.ts` — `createCodeOpener`, an injectable abstraction around
  shelling out to the `code` CLI (used by `workspace open`), so it's mockable
  in tests and doesn't fail silently if `code` isn't installed.
- `src/commands/workspace/` — one file per `spork workspace <verb>`
  subcommand (`create`, `add-repo`, `remove-repo`, `remove`, `list`,
  `status`, `open`), each exporting a plain `run<Verb>` function (the
  testable logic) and a `register<Verb>Command` that wires it to commander
  and prints the result. `add-repo` also prints whether submodules were
  initialized, or a warning if that failed (the add itself still succeeds —
  see `AddRepoResult` in `@spork/core`). `index.ts` in this folder registers
  them all under the `workspace` parent command. See
  [docs/plans/0001-worktree-workspace-architecture.md](../../docs/plans/0001-worktree-workspace-architecture.md)
  for the command surface and its rationale.

## Testing

`yarn test` (vitest, ≥80% coverage enforced). Commands are tested with
`@spork/core` mocked — this package's tests never touch the filesystem or
spawn a subprocess.
