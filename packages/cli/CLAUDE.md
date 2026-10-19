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
  don't get this (see their own doc comments for why).
- A destructive `workspace` command (`remove`, `remove-repo`) always runs
  through `confirmDestructive.ts`, even when its target was given
  explicitly rather than picked — don't gate the confirmation on "was this
  interactive," the destructiveness is what matters. Give it a `--yes`/`-y`
  flag so scripts/CI have an explicit bypass; don't invent a second way to
  skip it.
- When a command has one positional argument that must stay required
  (can't be prompted away) alongside one becoming optional, don't just
  mark both `[optional]` and trust commander's left-to-right fill — it
  always fills the *first* declared slot from a lone argument, regardless
  of which one you meant to keep. `add-repo`'s `resolveAddRepoArgs` is the
  pattern: capture both as plain optional strings, then disambiguate by
  count in the action handler so a lone argument lands on the one that was
  never optional to begin with. Only needed when the *other*, always-
  optional argument comes first in the declared order (`remove-repo`'s
  `[workspace] [folder]` doesn't need this — a lone argument already
  landing on `workspace`, the right one, is what you want there).
