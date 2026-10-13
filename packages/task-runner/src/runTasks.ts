import process from 'node:process'
import { spawnTask } from './spawnTask.js'
import { LiveDashboard } from './terminal.js'
import type { RenderStream, RunTasksOptions, Task, TaskResult, TaskState } from './types.js'

function toResult(state: TaskState): TaskResult {
  return {
    name: state.task.name,
    exitCode: state.exitCode,
    signal: state.signal,
    durationMs: state.startedAt === null ? 0 : (state.endedAt ?? Date.now()) - state.startedAt,
    output: state.output,
    cancelled: state.status === 'cancelled',
  }
}

/**
 * Runs every task concurrently, rendering a live dashboard as they go (see
 * `LiveDashboard`). Never calls `process.exit` — it resolves with a result
 * per task (including any left `cancelled` by Ctrl+C or an aborted
 * `options.signal`) and leaves deciding the process's exit code to the
 * caller. A failing task does not cancel its siblings; they all run to
 * completion.
 */
export async function runTasks(tasks: Task[], options: RunTasksOptions = {}): Promise<TaskResult[]> {
  const stream = options.stream ?? (process.stdout as unknown as RenderStream)
  const controller = new AbortController()
  const abort = (): void => controller.abort()

  options.signal?.addEventListener('abort', abort)
  process.on('SIGINT', abort)

  const states: TaskState[] = tasks.map((task) => ({
    task,
    status: 'pending',
    output: [],
    startedAt: null,
    endedAt: null,
    exitCode: null,
    signal: null,
  }))

  const dashboard = new LiveDashboard(stream, states)
  dashboard.start()

  try {
    await Promise.all(states.map((state) => spawnTask(state, controller.signal, () => dashboard.notify())))
  } finally {
    dashboard.stop()
    process.off('SIGINT', abort)
    options.signal?.removeEventListener('abort', abort)
  }

  return states.map(toResult)
}
