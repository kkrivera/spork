import { runTasks, type FunctionTask } from '@spork/task-runner'

export interface ConcurrentItem<T> {
  name: string
  call: () => Promise<T>
}

export interface ConcurrentOutcome<T> {
  name: string
  value?: T
  error?: string
  cancelled: boolean
}

/**
 * Runs several named async calls concurrently through `@spork/task-runner`'s
 * live dashboard, then hands back each one's outcome. `@spork/task-runner`'s
 * own `TaskResult` stays process-shaped (exit code/signal, no return value
 * slot) — rather than making that generic, each item's resolved value is
 * captured into an outer array by index via closure, and zipped back here.
 * This is the one place spork's commands translate "run these core calls
 * concurrently and tell me what happened" into task-runner's `Task`/
 * `TaskResult` shape; every wired command just builds the `items` list and
 * reads the outcomes.
 */
export async function runConcurrently<T>(items: ConcurrentItem<T>[]): Promise<ConcurrentOutcome<T>[]> {
  const values: Array<T | undefined> = []
  // Tracked separately from `values` so a call that legitimately resolves to
  // `undefined` isn't mistaken for a failure below.
  const succeeded: boolean[] = []

  const tasks: FunctionTask[] = items.map((item, index) => ({
    name: item.name,
    run: async () => {
      values[index] = await item.call()
      succeeded[index] = true
    },
  }))

  const results = await runTasks(tasks)

  return results.map((result, index) => ({
    name: result.name,
    value: values[index],
    error: !succeeded[index] && !result.cancelled ? (result.output.at(-1) ?? 'failed') : undefined,
    cancelled: result.cancelled,
  }))
}
