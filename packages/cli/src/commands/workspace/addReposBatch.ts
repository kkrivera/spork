import { addRepo, defaultAlias, type AddRepoResult } from '@spork/core'
import type { TaskReporter } from '@spork/task-runner'
import { runConcurrently } from '../../concurrentTasks.js'
import { workspaceContext, type AppContext } from '../../context.js'

export interface AddRepoBatchFailure {
  source: string
  reason: string
  cancelled: boolean
}

/** One entry per source, in the order given — exactly one of `result`/`failure` is set. */
export interface AddRepoBatchOutcome {
  source: string
  result?: AddRepoResult
  failure?: AddRepoBatchFailure
}

/**
 * Adds every source to the given workspace directory concurrently (through
 * `runConcurrently`'s live dashboard), calling `@spork/core`'s `addRepo`
 * directly rather than going through the standalone `add-repo` command's
 * own single-item wrapper (`runAddRepo`), which would otherwise nest one
 * dashboard per repo here instead of one dashboard for the whole batch.
 * Not atomic, and not fail-fast: every source is attempted regardless of a
 * sibling's failure — shared by `workspace create --repo ...` and
 * `add-repo`'s own zero-argument, pick-from-the-registry flow. The caller
 * is expected to print every outcome and throw afterward if any failed, to
 * keep the process exiting non-zero without losing whichever repos did
 * succeed.
 */
export async function addReposToWorkspace(
  ctx: AppContext,
  dir: string,
  sources: readonly string[],
  options: { global?: boolean },
): Promise<AddRepoBatchOutcome[]> {
  const outcomes = await runConcurrently(
    sources.map((source) => ({
      name: defaultAlias(source),
      call: (report: TaskReporter) => {
        report.log(`cloning/fetching ${source}...`)
        return addRepo(workspaceContext(ctx), dir, { source, global: options.global })
      },
    })),
  )

  return outcomes.map((outcome, index) => {
    const source = sources[index] as string
    if (outcome.value) return { source, result: outcome.value }
    return {
      source,
      failure: { source, cancelled: outcome.cancelled, reason: outcome.cancelled ? 'cancelled' : (outcome.errorMessage ?? 'failed') },
    }
  })
}
