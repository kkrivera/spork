import { runTasks, type FunctionTask } from '@spork/task-runner'

export interface ConcurrentItem<T> {
  name: string
  call: () => Promise<T>
}

export interface ConcurrentOutcome<T> {
  name: string
  value?: T
  /** The raw value `call()` threw, if any — re-throw this to preserve a single-item command's existing error-propagation contract. */
  error?: unknown
  /** `error instanceof Error ? error.message : String(error)` — convenient for just printing a reason, without needing to narrow `error` yourself. */
  errorMessage?: string
  cancelled: boolean
}

/**
 * Runs several named async calls concurrently through `@spork/task-runner`'s
 * live dashboard, then hands back each one's outcome. `@spork/task-runner`'s
 * own `TaskResult` stays process-shaped (exit code/signal, no return value
 * slot) — rather than making that generic, each item's resolved value (and
 * any thrown error) is captured into outer arrays by index via closure, and
 * zipped back here. This is the one place spork's commands translate "run
 * these core calls concurrently and tell me what happened" into
 * task-runner's `Task`/`TaskResult` shape; every wired command just builds
 * the `items` list and reads the outcomes — a batch command (several items)
 * typically reports each `errorMessage` and continues, while a single-item
 * command typically re-throws the raw `error` to preserve this project's
 * existing "let it propagate to the top-level handler" convention.
 */
export async function runConcurrently<T>(items: ConcurrentItem<T>[]): Promise<ConcurrentOutcome<T>[]> {
  const values: Array<T | undefined> = []
  const errors: unknown[] = []
  // Tracked separately from `values` so a call that legitimately resolves to
  // `undefined` isn't mistaken for a failure below.
  const succeeded: boolean[] = []

  const tasks: FunctionTask[] = items.map((item, index) => ({
    name: item.name,
    run: async () => {
      try {
        values[index] = await item.call()
        succeeded[index] = true
      } catch (error) {
        errors[index] = error
        throw error
      }
    },
  }))

  const results = await runTasks(tasks)

  return results.map((result, index) => {
    const failed = !succeeded[index] && !result.cancelled
    const error = errors[index]
    return {
      name: result.name,
      value: values[index],
      error: failed ? error : undefined,
      errorMessage: failed ? (error instanceof Error ? error.message : (result.output.at(-1) ?? String(error))) : undefined,
      cancelled: result.cancelled,
    }
  })
}
