# @spork/prompts

Interactive terminal prompts for the `spork` CLI, starting with a fuzzy
single/multi-select list — pick from a list of options by typing to
narrow it, toggling selections with space, and confirming with Enter.
Not yet wired into any `spork` command; built standalone first so it has
a fully tested, self-contained surface to wire in against.

## Structure

- `src/fuzzy.ts` — `fuzzyMatch(query, text)`: a greedy subsequence matcher
  (every query character must appear in order, case-insensitive) scored to
  favor a contiguous run and a match right after a separator (`/`, `-`,
  `_`, `.`, space) or at the very start — so typing "iam" ranks
  `iam-privilege-catalog` above a name that merely contains those letters
  scattered apart. Returns `null` on no match; an empty query matches
  everything with score `0`. Built from scratch rather than taking a
  `fzf`/`fuzzysort` dependency, matching this repo's precedent of building
  `@spork/task-runner` itself instead of depending on `ultra-runner`.
- `src/keys.ts` — `toKey(str, key)`: translates a raw `node:readline`
  keypress into the small, terminal-independent `Key` vocabulary the state
  reducer consumes (`up`/`down`/`space`/`enter`/`escape`/`selectAll`/
  `clearQuery`/`backspace`/`char`). Ctrl+C and Escape both cancel; Ctrl+A
  is repurposed as select/deselect-all and Ctrl+U as "clear the whole
  query" (there's no cursor position within the query to partially clear
  to, so readline's usual line-editing bindings collapse to this). Space
  is recognized by the literal character, not `key.name` (reported
  inconsistently across platforms), so it's always a toggle, never typed
  into the search.
- `src/state.ts` — the whole prompt as one pure reducer:
  `applyKey(state, key)`. `SelectState.selected` tracks original option
  indices, not positions in the filtered view, so narrowing a search and
  then clearing it doesn't lose prior selections. `selectAll` toggles
  select/deselect only over the *currently filtered* set, leaving
  anything filtered out untouched. Enter is rejected with a
  `validationMessage` (not closed) when a multi-select's `minSelected`
  isn't met. A no-op once `state.done` is set.
- `src/layout.ts` — `clampWidth` (truncates an overlong line so it can't
  wrap and desync a redrawn frame) and `computeViewport` (the window of
  the filtered list to render, `height` items wide, keeping the cursor
  centered when there's room — a pure function of `(cursor, total,
  height)` alone, no memory of previous scroll position needed).
- `src/render.ts` — `renderFrame(state, message, columns, rows, colors)`:
  a header/search line, the viewport-windowed option list (cursor pointer,
  `[x]`/`[ ]` checkbox for multi-select, bolded fuzzy-matched characters,
  a dimmed `hint` per option), and a footer (selection count + key hints,
  or the validation message in their place). Takes an explicit `Colors`
  param rather than importing `picocolors` directly — same convention
  `@spork/task-runner`'s `render.ts` uses, since the real `process.stdout`
  can disagree with whatever stream was actually injected.
- `src/terminal.ts` — `runSelectPrompt`, the stateful driver: hides the
  cursor, redraws on every `'keypress'`/output-resize event (erase +
  rewrite, same approach as `@spork/task-runner`'s `LiveDashboard`, except
  per-keypress rather than on a timer tick), and resolves once the state
  settles. Expects a stream that already emits `'keypress'` events —
  wiring up `node:readline`'s real decoder is `select.ts`'s job, not this
  function's, so tests can drive it with synthetic `'keypress'` events
  directly, without a real TTY's escape-sequence parsing.
- `src/select.ts` — the public entry point, `select(config)`. Throws
  `NotInteractiveError` synchronously if either stream isn't a TTY, rather
  than hanging on keypresses that can never arrive; has no opinion on what
  a non-interactive caller should do instead (that's a per-command policy
  decision — see `packages/cli/CLAUDE.md`). Resolves with the selected
  values in their original order, or `null` on cancel (Esc/Ctrl+C) — a
  normal, resolved outcome, mirroring `@spork/task-runner`'s own
  "cancelled is a result, not an exception" shape.
- `src/types.ts` — `PromptOption`, `SelectConfig`, `NotInteractiveError`,
  the injectable `PromptInputStream`/`PromptOutputStream` (the narrow
  subsets of `NodeJS.ReadStream`/`WriteStream` this package needs — small
  enough to fake in tests, same pattern as `@spork/task-runner`'s
  `RenderStream`), and the raw `NodeKeypress`/terminal-independent `Key`
  shapes.
- `src/index.ts` — exports `select`, `PromptOption`, `SelectConfig`,
  `NotInteractiveError`, and the `Colors`/stream types a caller needs to
  pass its own.

## Testing

`yarn test` (vitest, ≥80% coverage enforced). Everything through
`render.ts` is pure and tested directly with no I/O. `terminal.ts`/
`select.ts` are tested against a fake `PromptInputStream`/
`PromptOutputStream` (`EventEmitter`s with a recording `write()`),
emitting synthetic `'keypress'` events rather than driving a real TTY's
escape-sequence decoder. The one thing those fakes can't cover — real
`node:readline` keypress decoding end-to-end against an actual
pseudo-terminal — was verified manually instead (a real pty, fuzzy
search, select-all/none, clear-search-keeps-selections, confirm, and
cancel all behaving as designed, with the process exiting on its own
afterward either way).
