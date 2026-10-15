# @spork/task-runner

Runs one or more tasks concurrently and renders a live terminal dashboard
while they run, styled after
[ultra-runner](https://www.npmjs.com/package/ultra-runner): a status
icon + name + duration header per task, a tail of each still-running task's
most recent output beneath it, and — once everything settles — a permanent
full log in place of the live view. A task is either a `ProcessTask` (a
real spawned command, tailed via its own stdout/stderr) or a `FunctionTask`
(an arbitrary async function — for work that's just TypeScript calling
other TypeScript, with no subprocess to tail). Not yet wired into any
`spork` command; built ahead of that so future parallel operations (e.g.
across several repos at once) have somewhere to render.

## Structure

- `src/runTasks.ts` — the public entry point. Runs every task
  concurrently (dispatching each one to `spawnTask` or `runFunctionTask`
  via `isProcessTask`, `'command' in task`), drives a `LiveDashboard`, and
  resolves with one `TaskResult` per task once all of them have settled or
  been cancelled. Never calls `process.exit` — deciding the process's exit
  code is left to the caller.
- `src/spawnTask.ts` — wraps a single `node:child_process.spawn` call (a
  `ProcessTask`) into a small state machine
  (`pending → running → success/failed/cancelled`), capturing stdout+stderr
  interleaved in arrival order (newline-split, buffering a trailing partial
  line across chunks) and mutating the shared `TaskState` object the caller
  handed it in place — the dashboard reads straight off that same object,
  no separate state-merging step.
- `src/runFunctionTask.ts` — the same state-machine contract as
  `spawnTask.ts`, but for a `FunctionTask`: runs its `run(report, signal)`,
  letting the body push its own progress lines via `report.log(...)` (there's
  no subprocess output to capture instead). A thrown error is captured into
  `state.output` the same way `spawnTask` captures a spawn error. No
  kill-escalation here — there's no child process to kill, so cancellation
  for a function task is cooperative: the body must itself notice
  `signal.aborted` to stop early, otherwise the task only settles once its
  `run` call actually returns.
- `src/layout.ts` — pure functions: `formatDuration` (`"919ms"` /
  `"3.727s"`), `tailLinesPerRunningTask` (splits the terminal's rows evenly
  across still-running tasks, after reserving one row per already-finished
  task's one-line summary — the "1/n portion, reclaimed as tasks finish"
  rule), and `clampWidth` (truncates an overlong line with an ellipsis so
  it can't wrap and desync the layout).
- `src/render.ts` — pure `renderLiveFrame` (the truncated, tail-only live
  view) and `renderFinalLog` (every task's complete captured output, once
  settled — a quiet successful task naturally shows nothing beneath its
  header, matching ultra-runner's own screenshot). Both take an explicit
  `Colors` (a `picocolors.createColors(enabled)` result) rather than
  relying on picocolors' own global TTY auto-detection, since that can
  disagree with whether the *injected* stream is actually a TTY.
- `src/terminal.ts` — `LiveDashboard`, which owns the redraw loop against
  an injectable `RenderStream`: hides/restores the cursor, erases and
  redraws exactly as many lines as the previous frame drew on every tick
  (~10fps) or stream `resize` event, and falls back to a plain, prefixed,
  incrementally-streamed `[taskName] line` mode with no cursor tricks when
  the stream isn't a TTY (CI, a pipe).
- `src/types.ts` — `Task` (`ProcessTask | FunctionTask`), `TaskReporter`,
  `isProcessTask`, `TaskState`, `TaskResult`, `RunTasksOptions`, and
  `RenderStream` (the narrow subset of `NodeJS.WriteStream` this package
  needs — small enough to fake in tests).

## Cancellation

`runTasks` creates one internal `AbortController` and passes its `signal`
straight into every `child_process.spawn` call (Node sends the child one
SIGTERM when it fires). A `process.on('SIGINT', ...)` listener (registered
only for the run's duration) aborts it on Ctrl+C; a caller-supplied
`options.signal` aborts it too.

That single SIGTERM is not treated as the end of the story: a process can
trap or ignore it (confirmed with a real test script that did exactly
that), and Node's own `signal` plumbing neither retries nor confirms the
process actually died. `spawnTask` backs it with a grace period — if the
process hasn't exited ~2s after the abort, it gets `SIGKILL`'d directly;
if even that goes unconfirmed, the task force-settles as `cancelled`
anyway after another ~2s, rather than leaving `runTasks` (or the process
it's running in) hanging on an orphan. Only the real `close` event (or
that final forced settle) ever resolves a task — never the abort, and
never Node's own `AbortError` on the child's `error` event, by itself.

Either way, still-running tasks settle with `status: 'cancelled'` rather
than being left hanging, and `runTasks` always resolves — it's the
caller's job to decide what exit code a cancelled run should produce.

A failing task does **not** cancel its siblings — they all run to
completion, and the final `TaskResult[]` reports each one's own outcome.

The above is all for a `ProcessTask`. A `FunctionTask` has no child process
to send a signal to at all — its cancellation is **cooperative only**: the
task is marked `cancelled` once its `run` call settles, but `signal`
aborting doesn't stop an in-flight `await` inside `run` by itself. A
function task that wants to actually stop early must check
`signal.aborted` itself.

## Testing

`yarn test` (vitest, ≥80% coverage enforced). `spawnTask` and `runTasks`
mock `node:child_process`'s `spawn` rather than spawning real processes
(same convention as `@spork/core`'s `src/git`); `runFunctionTask` needs no
such mocking, since its "process" is just a plain async function the test
provides directly. `terminal.ts`'s TTY and non-TTY paths are exercised
against a fake `RenderStream` (an `EventEmitter` recording `write()` calls)
rather than a real terminal.
