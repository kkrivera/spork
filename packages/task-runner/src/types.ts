export interface Task {
  name: string
  command: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
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
