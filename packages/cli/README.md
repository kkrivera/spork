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
- `src/commands/` — one file per CLI command, added as the v1 command
  surface is implemented (see
  [docs/plans/0001-worktree-workspace-architecture.md](../../docs/plans/0001-worktree-workspace-architecture.md)).

## Testing

`yarn test` (vitest, ≥80% coverage enforced). Commands are tested with
`@spork/core` mocked — this package's tests never touch the filesystem or
spawn a subprocess.
