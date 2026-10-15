# @spork/prompts — agent context

Interactive terminal prompts, starting with a fuzzy single/multi-select.
`src/index.ts` is this package's only public surface.

## Conventions specific to this package

- **Pure logic, stateful I/O kept separate.** `fuzzy.ts`, `keys.ts`,
  `state.ts`, `layout.ts`, and `render.ts` are all pure functions — no
  stream, no terminal, no `Date.now()`/timers. `terminal.ts` is the one
  place that touches a real (or faked) stream. Keep it this way: a new
  feature's *decision logic* (what the next state should be, what a frame
  should contain) belongs in the pure layer, tested directly: only the
  "drive it against a stream" wiring belongs in `terminal.ts`/`select.ts`.
- **`SelectState.selected` holds original option indices, not filtered
  positions.** This is what makes a cleared search still show prior
  selections — don't "simplify" it to track filtered-view positions
  instead, that silently drops a selection the moment the filter changes.
  `selectAll` only ever toggles over `state.filtered`, never the full
  `state.options` list, so a selection made before narrowing the search
  stays untouched by a select-all/none over the narrowed view.
- **`render.ts`'s functions take an explicit `Colors` parameter** — never
  import `picocolors` and call it directly from a rendering function, for
  the same reason `@spork/task-runner`'s `render.ts` doesn't: picocolors'
  own bare/global TTY detection checks the real `process.stdout`, which
  can disagree with whatever stream was actually injected (a test, or a
  caller piping this package's output elsewhere). `select.ts` is the one
  place that decides `enabled` from the stream it was actually given.
- **`terminal.ts` never calls `node:readline`'s `emitKeypressEvents`
  itself** — that's `select.ts`'s job. `terminal.ts`'s `runSelectPrompt`
  only assumes `input` already emits `'keypress'` events, however they got
  there, which is exactly what lets its own tests drive it with synthetic
  `'keypress'` events on a plain `EventEmitter` rather than needing a real
  TTY's escape-sequence parsing. Don't move the `emitKeypressEvents` call
  into `terminal.ts` to "simplify" `select.ts` — it would make
  `runSelectPrompt` untestable without a real pty.
- **`select()` throws `NotInteractiveError` synchronously rather than
  guessing a non-interactive fallback.** This package has no idea what a
  given `spork` command should do when it can't prompt (create something
  empty? require a flag instead? different per command) — that policy
  belongs at the call site in `packages/cli`, same way `repoScope.ts`
  owns the local/global scope policy instead of baking it into
  `@spork/core`. Don't add a built-in "read a line from stdin instead"
  fallback here; it would hide a real per-command decision.
- **Cancellation is a resolved `null`, not a thrown error** — mirrors
  `@spork/task-runner`'s `TaskResult.cancelled` ("cancelled is a normal
  outcome"). The CLI layer is where a cancelled prompt becomes a
  `SporkError('Cancelled.')`, consistent with every other cancelled-prompt
  path in that package.

## Tests

Mock nothing — everything through `render.ts` is pure and tested directly.
`terminal.ts`/`select.ts` are tested against fake `PromptInputStream`/
`PromptOutputStream` (`EventEmitter`s implementing the narrow interfaces
in `types.ts`, with a recording `write()`), emitting synthetic
`'keypress'`/`'resize'` events rather than driving a real TTY. See root
[CONTRIBUTING.md](../../CONTRIBUTING.md) for the coverage bar (≥80%).

Real `node:readline` keypress decoding against an actual pseudo-terminal
isn't covered by the automated suite — that gap was closed with a manual
smoke test (Python's `pty.fork`, since there's no interactive TTY to type
into in this environment) when this package was first built. Re-run
something similar after a change to `keys.ts` or `terminal.ts`'s raw-mode
handling specifically; the pure-logic layers don't need it.
