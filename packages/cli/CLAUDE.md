# @spork/cli — agent context

Thin layer only: argument parsing (`commander`) and output formatting. Any
new business logic belongs in `@spork/core`, imported only from its
`src/index.ts` public surface — never reach into `@spork/core/src/*`.

- All user-facing text goes through `output/color.ts`'s `Ui` — don't call
  `picocolors` directly in a command, and don't `console.log` raw ANSI codes.
  A command must read correctly with color off (CI, `--no-color`, non-TTY).
- An interactive prompt (via `@spork/prompts`) is allowed, but only as an
  *addition* to an explicit-flag path that still works unattended in CI —
  never make a prompt the only way to drive a command. `@spork/prompts`'s
  `select()`/`confirm()` both throw `NotInteractiveError` when they can't
  prompt (no TTY); catch that specifically and fall back to the command's
  existing non-interactive behavior, the way `workspace create`'s
  `resolveRepoSources`/`offerToOpenInVSCode` do. A real cancel (Esc/Ctrl+C)
  resolves `select()` with `null`, not a thrown error — turn that into a
  thrown `SporkError` at the call site, same as every other
  cancelled-prompt path here. `confirm()` doesn't need that: Esc/Ctrl+C
  just resolve `false`, same as declining, since there's nothing further
  to distinguish once a yes/no question settles.
- Errors from `@spork/core` (`SporkError`) are user-facing but are **not**
  caught per-command — they're left to propagate out of the async `.action()`
  handler, through `main()`, to `src/index.ts`'s top-level `handleFatalError`
  (prints in red, sets a failing exit code). Don't add try/catch in a command
  unless you need to do something command-specific before re-throwing.
- Each command file splits into a plain `run<Verb>(ctx, ...)` function (the
  testable logic — no commander, no `console.log`) and a
  `register<Verb>Command(program, ctx)` that wires it up and prints. Follow
  this split for any new command rather than putting logic inside `.action()`.
- Two command noun groups: `workspace` and `repo`. A verb's meaning is
  scoped by its noun group (like git's `remote add` vs `submodule add`) —
  don't rename `workspace add-repo`/`remove-repo` to bare `add`/`remove` even
  though `repo add`/`remove` now exist; the `-repo` suffix is what keeps
  `workspace remove` (destroy the whole workspace) unambiguous from
  `workspace remove-repo` (drop one repo from it).
- Building a context for a `@spork/core` call: use `context.ts`'s narrowing
  helpers (`workspaceContext`, `repoContext`, `removeRepoSourceContext`)
  rather than hand-writing `{ reposRoot: ctx.reposRoot, ... }` at the call
  site — if a core context type gains a field, only the helper needs to
  change.
- Local-vs-global scoping only applies to the standalone `repo` commands —
  route it through `repoScope.ts`'s `resolveRepoScope`/`describeRepoScope`
  rather than reimplementing the `--global`/`--local`/cwd-detection decision
  per command. `workspace` commands don't need this at all (they already
  know their target workspace by name) — don't add scope flags there.
- A `workspace <verb>` command whose workspace argument can be omitted
  routes through `commands/workspace/pickWorkspace.ts`'s
  `pickWorkspaceName`/`pickWorkspaceNames` rather than hand-rolling a
  `select()` call — keeps the `NotInteractiveError`→`SporkError` wording
  and the "resolves to a name, not a dir" contract consistent across
  `add-repo`/`remove-repo`/`remove`/`status`/`open`. `create` and `list`
  don't get this (see their own doc comments for why). `pickWorkspaceName`
  (single-select only, not the multi-select `pickWorkspaceNames`) also
  auto-detects the cwd's enclosing workspace first and skips the prompt
  entirely when there is one — mirroring `repoScope.ts`'s cwd-based
  local/global default for `spork repo`. Don't extend that auto-detect to
  `pickWorkspaceNames`: picking several is the whole point of a multi-select,
  so silently collapsing it to "just the one you're sitting in" would
  undermine it, not help it.
- A destructive `workspace` command (`remove`, `remove-repo`) always runs
  through `confirmDestructive.ts`, even when its target was given
  explicitly rather than picked — don't gate the confirmation on "was this
  interactive," the destructiveness is what matters. Give it a `--yes`/`-y`
  flag so scripts/CI have an explicit bypass; don't invent a second way to
  skip it.
- A multi-item command must never buffer every item's result into an
  array and print it only after the whole batch finishes — a user watching
  the terminal needs to see progress as each item completes, not a wall of
  silence followed by a burst of output at the end (`remove`'s old plain
  `for` loop did exactly this, by accident, before it was moved onto
  `runConcurrently`). When the items can run concurrently (the common
  case — check whether anything actually requires strict ordering, the way
  `remove`'s doc comment reasons through it), route them through
  `runConcurrently`/`concurrentTasks.ts` and get live per-item progress for
  free, including its non-TTY streamed-line fallback — don't reach for a
  bespoke progress mechanism when this one already exists and is already
  the established pattern (`create --repo`, `repo scan`, `remove`, now
  `remove-repo` too). If
  a future command's items genuinely cannot run out of order (a real
  dependency between them, not just "it happens to be simpler to write"),
  `run<Verb>` still must not go silent for the whole loop — give it a
  per-item callback (invoked right after each item settles) that
  `register<Verb>Command` uses to print immediately, the same way
  `runConcurrently`'s `TaskReporter.log()` lets a concurrent item's `call`
  report progress without `run<Verb>` itself calling `console.log`. Don't
  build this callback plumbing speculatively, though — there's no command
  today that actually needs forced sequential ordering; add it when one
  does.
- When a command has one positional argument that must stay required
  (can't be prompted away) alongside a second one becoming optional, don't
  reach for a second positional and disambiguate by argument count — it's
  fragile the moment a third real use case (a lone argument meaning either
  one, depending on what the user had in mind) shows up, and commander's
  own left-to-right fill will always assign a lone argument to the
  *first* declared slot regardless of which one you meant to keep. Put the
  optional one behind its own named flag instead (`add-repo`'s
  `[source]` positional plus `--workspace`/`-w <name>` is the pattern):
  the one positional left is then always unambiguous, and the flag is
  either given or it isn't, no count-based guessing required.
  `remove-repo` follows the same pattern as `add-repo`: `[folders...]`
  (variadic — it can remove several at once) plus `--workspace`/`-w`,
  rather than a `[workspace] [folder]` positional pair.
