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
- Errors from `@spork/core` (`SporkError`) are user-facing; catch them at the
  command level and print the message via `ui.color.red`, not a raw stack
  trace. Unexpected errors can fall through to `src/index.ts`'s top-level
  handler.
