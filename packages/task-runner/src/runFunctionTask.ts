import type { FunctionTask, TaskState } from './types.js'

/** Narrows `state.task` for the caller — `runTasks.ts`'s `isProcessTask` dispatch is what actually guarantees this holds. */
function asFunctionTask(state: TaskState): FunctionTask {
  return state.task as FunctionTask
}

/**
 * Runs `state.task.run`, mutating `state` in place the same way `spawnTask`
 * does, so the dashboard treats a function task identically to a process
 * one. Resolves once `run` settles (never earlier) — a thrown error is
 * captured into `state.output` (mirroring `spawnTask`'s ENOENT handling) and
 * marks the task `failed`, unless `signal` had already aborted, in which
 * case it's `cancelled` instead. There is no kill-escalation here: there's
 * no child process to kill, so cancellation for a function task only takes
 * effect once its `run` call actually returns (see `FunctionTask`'s doc
 * comment on cooperative cancellation).
 */
export async function runFunctionTask(
  state: TaskState,
  signal: AbortSignal,
  onChange: (state: TaskState) => void,
): Promise<TaskState> {
  const task = asFunctionTask(state)
  state.status = 'running'
  state.startedAt = Date.now()
  onChange(state)

  const reporter = {
    log: (line: string): void => {
      state.output.push(line)
      onChange(state)
    },
  }

  try {
    await task.run(reporter, signal)
    state.status = signal.aborted ? 'cancelled' : 'success'
  } catch (error) {
    state.output.push(error instanceof Error ? error.message : String(error))
    state.status = signal.aborted ? 'cancelled' : 'failed'
  }

  state.endedAt = Date.now()
  onChange(state)
  return state
}
