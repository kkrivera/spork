/** A task whose body is a real spawned process — tailed via its own stdout/stderr. */
export interface ProcessTask {
  name: string
  command: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export interface TaskReporter {
  log(line: string): void
}

/**
 * A task whose body is an arbitrary async function rather than a spawned
 * process — for work that's just TypeScript calling into other TypeScript
 * (e.g. `@spork/core`), which has no subprocess to tail. `report.log(...)`
 * lets the body push its own progress lines into the dashboard.
 *
 * Cancellation here is cooperative only: aborting `signal` does not forcibly
 * stop an in-flight `await` inside `run` the way a process task's child gets
 * killed — the task is simply marked `cancelled` once `run` settles (success,
 * throw, or the body itself checking `signal.aborted` and returning early).
 */
export interface FunctionTask {
  name: string
  run: (report: TaskReporter, signal: AbortSignal) => Promise<void>
}

export type Task = ProcessTask | FunctionTask

/** True for a `ProcessTask` — the two shapes are distinguished by `command`'s presence. */
export function isProcessTask(task: Task): task is ProcessTask {
  return 'command' in task
}

export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled'

/** A task's live state, as tracked by `spawnTask` and read by the renderer. */
export interface TaskState {
  task: Task
  status: TaskStatus
  /** Captured stdout+stderr, interleaved in arrival order, newline-split. */
  output: string[]
  startedAt: number | null
  endedAt: number | null
  exitCode: number | null
  signal: NodeJS.Signals | null
}

export interface TaskResult {
  name: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  durationMs: number
  output: string[]
  cancelled: boolean
}

/** The subset of `NodeJS.WriteStream` the renderer needs — narrow enough to fake in tests. */
export interface RenderStream {
  write(chunk: string): boolean
  isTTY?: boolean
  columns?: number
  rows?: number
  on(event: 'resize', listener: () => void): unknown
  off(event: 'resize', listener: () => void): unknown
}

export interface RunTasksOptions {
  /** Defaults to `process.stdout`. Injectable so tests don't need a real TTY. */
  stream?: RenderStream
  /** Combined with an internal controller that's aborted on Ctrl+C (SIGINT). */
  signal?: AbortSignal
}
