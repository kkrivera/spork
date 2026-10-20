# @spork/cli — agent context

Thin layer only: argument parsing (`commander`) and output formatting. Any
new business logic belongs in `@spork/core`, imported only from its
`src/index.ts` public surface — never reach into `@spork/core/src/*`.

- All user-facing text goes through `output/color.ts`'s `Ui` — don't call
  `picocolors` directly in a command, and don't `console.log` raw ANSI codes.
  A command must read correctly with color off (CI, `--no-color`, non-TTY).
- Every `SPORK_*` environment variable is read in exactly one place —
  `env.ts`'s `readSporkEnv`, attached to `AppContext` as `ctx.env` by
  `createAppContext`. Don't read `process.env.SPORK_*` directly from a
  command; add a field to `SporkEnv`/`readSporkEnv` instead, so there's one
  place that documents (and tests) the whole set. Precedence when a flag
  has an env-var fallback is always explicit flag, then the env var, then
  whatever hardcoded default existed before (`workspace create`'s `--dir`
  → `SPORK_WORKSPACE_DIR` → cwd is the first one) — don't let the env var
  outrank an explicit flag.
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
  report progress without `run<Verb>` itself calling `console.log`. No
  command needs this for a *batch* yet, so don't build it speculatively
  for that case — but `exec`'s `onResolved` callback is the same shape
  applied to a single long-running action: `run<Verb>` still can't print,
  yet something needs to tell the user which workspace got auto-picked
  *before* the (possibly interactive, possibly slow) command takes over
  the terminal, not after it returns.
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
- `workspace init <name>` is the one command that always targets `cwd`
  directly (never a `--dir`, unlike `create`, whose `--dir` is a *parent*
  directory) — it turns an already-existing folder into a workspace in
  place rather than creating a new one, so there's no "where should this
  go" decision to make the way `create`'s does. It's also the one command
  whose underlying `@spork/core` calls (`initAndRegisterWorkspace`,
  `adoptRepoIntoWorkspace`) are guaranteed to never create a git worktree
  or touch a branch, for anything they adopt — don't add a code path here
  that could call `addRepo`/`addWorktree` for an adopted folder, even as
  an optimization or a "fix" for something that looks inconsistent; that
  guarantee is the entire point of the command (see
  [docs/plans/0003-workspace-init.md](../../docs/plans/0003-workspace-init.md)).
- `workspace exec` is the one command whose underlying work is a single,
  typically long-running or interactive foreground process (a dev
  server, a watcher) rather than a short task or batch of them — don't
  route it through `runConcurrently`/`@spork/task-runner`'s live
  dashboard the way every other multi-item command here does. That
  dashboard is built around tasks that settle and get tailed into a
  pane; a real dev server wants the actual terminal (raw stdout, working
  Ctrl+C, no buffering), which is exactly what `commandExecutor.ts`'s
  `stdio: 'inherit'` gives it. If a future command's job is similarly "run
  one interactive/long-lived foreground process," follow `exec`'s
  pattern (an injectable `CommandExecutor`-shaped abstraction), not
  `runConcurrently`'s. `createShellExecutor` also forwards
  `SIGINT`/`SIGTERM`/`SIGHUP` from spork's own process to the child and
  waits for it to actually exit before resolving (escalating to
  `SIGKILL` past a grace period, or immediately on a repeat signal) —
  don't assume a real terminal's Ctrl+C alone covers this: that reaches
  the child for free via process-group inheritance, but something
  signaling spork's own PID directly (a supervisor, a script) wouldn't,
  without this, and the child would be orphaned rather than stopped.
  `createShellExecutor` also resolves the shell to run `command` through
  as `$SHELL`, not Node's `shell: true` default — don't change that back
  to a bare `true`/hardcoded `/bin/sh`: on macOS that's a restricted,
  POSIX-strict bash that rejects syntax real bash/zsh accept (confirmed
  directly — a hyphenated function name in a real `.bashrc` is valid
  bash but a parse error under it), so the moment `command` sources a
  real dotfile, a hardcoded `/bin/sh` breaks it.
- `create`'s "open it now?" offer and `open` itself both dispatch through
  `launchTarget.ts`'s `launchWorkspace`/`LaunchDeps` rather than each
  hand-rolling "VS Code vs Claude" — that's the one shared place deciding
  which tool to launch, built on the same `Opener` (`opener.ts`) and
  `CommandExecutor` (`commandExecutor.ts`) abstractions those two already
  are. If a third tool ever needs to be launchable here, add it to
  `LaunchTarget`/`LAUNCH_TARGET_OPTIONS`/`launchWorkspace` rather than
  letting `create.ts`/`open.ts` grow their own copies of the dispatch.
  Claude is launched through the same foreground/inherited-stdio
  `CommandExecutor` `exec` uses (it's an interactive terminal app, not a
  background-launchable GUI one like VS Code) — don't try to make it
  behave like the `Opener` path by, say, detaching it or capturing its
  output; that would break the whole point of handing the user their own
  terminal back.
