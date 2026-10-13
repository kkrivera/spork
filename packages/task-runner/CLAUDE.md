# @spork/task-runner — agent context

Standalone concurrent-task runner + live terminal dashboard. Not yet consumed
by `packages/cli` — built ahead of that integration so it has somewhere to
land. `src/index.ts` is this package's only public surface.

## Conventions specific to this package

- `spawnTask` mutates the `TaskState` object its caller passed in, rather
  than creating and returning its own — the dashboard and the orchestrator
  must observe the *same* object reference. Don't have it construct its own
  internal state and return a different object; that silently breaks live
  rendering (the dashboard keeps watching stale objects).
- `render.ts`'s functions take an explicit `Colors` (`picocolors.createColors(enabled)`)
  parameter — never import `picocolors` and call `pc.green(...)` etc.
  directly from a rendering function. Picocolors' own bare global detection
  checks the real `process.stdout`, which can disagree with whether the
  *injected* `RenderStream` this package was actually given is a TTY
  (e.g. in a test, or a caller piping our stream elsewhere). `terminal.ts`
  is the one place that decides `enabled` (from the stream it was given)
  and constructs the `Colors` object.
- Cancellation goes through `AbortSignal`, not manual child-process PID
  bookkeeping — `child_process.spawn`'s own `signal` option sends the
  child's first kill signal. But that's not sufficient by itself: a
  process can trap/ignore that SIGTERM (confirmed with a real test
  script), and Node doesn't retry or confirm the process actually died.
  `spawnTask` backs it with a grace-period SIGKILL escalation and a final
  forced-settle timeout (see `KILL_GRACE_MS`) — never remove that and
  settle directly off the abort or the child's `error` event, or a
  cancelled run can report `cancelled` while the underlying process (and
  its own children) are still alive, potentially outliving the whole
  program as orphans. Wire any new cancellation source (another signal, a
  timeout) into the same internal `AbortController` in `runTasks.ts`
  instead of adding a parallel kill path.
- `runTasks` must never call `process.exit` — it's a library function.
  Restoring the terminal (showing the cursor again, un-registering the
  `SIGINT` listener) happens in `finally` blocks regardless of how the run
  ends; deciding the process's exit code is the caller's job.

## Tests

Mock `node:child_process`'s `spawn` (don't spawn real processes — same
convention as `@spork/core`'s `src/git`). Fake `RenderStream` as an
`EventEmitter` with a recording `write()`, rather than trying to drive a
real TTY. See root [CONTRIBUTING.md](../../CONTRIBUTING.md) for the
coverage bar (≥80%).
