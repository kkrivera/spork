# @spork/cli — agent context

Thin layer only: argument parsing (`commander`) and output formatting. Any
new business logic belongs in `@spork/core`, imported only from its
`src/index.ts` public surface — never reach into `@spork/core/src/*`.

- All user-facing text goes through `output/color.ts`'s `Ui` — don't call
  `picocolors` directly in a command, and don't `console.log` raw ANSI codes.
  A command must read correctly with color off (CI, `--no-color`, non-TTY).
- Commands should stay non-interactive in v1 (explicit flags/args only, no
  prompts) so they work unattended in CI — see the root design doc's
  deferred-items list for when interactive prompts are reconsidered.
- Errors from `@spork/core` (`SporkError`) are user-facing but are **not**
  caught per-command — they're left to propagate out of the async `.action()`
  handler, through `main()`, to `src/index.ts`'s top-level `handleFatalError`
  (prints in red, sets a failing exit code). Don't add try/catch in a command
  unless you need to do something command-specific before re-throwing.
- Each command file splits into a plain `run<Verb>(ctx, ...)` function (the
  testable logic — no commander, no `console.log`) and a
  `register<Verb>Command(program, ctx)` that wires it up and prints. Follow
  this split for any new command rather than putting logic inside `.action()`.
