import { addRepoSourceOrAlias, defaultAlias, SporkError, type RepoRegistryEntry } from '@spork/core'
import type { TaskReporter } from '@spork/task-runner'
import type { Command } from 'commander'
import { runConcurrently } from '../../concurrentTasks.js'
import type { AppContext } from '../../context.js'
import { describeRepoScope, resolveRepoScope, type RepoScopeOptions } from '../../repoScope.js'

export interface AddOptions extends RepoScopeOptions {
  as?: string
}

export interface AddResult {
  entry: RepoRegistryEntry
  scopeLabel: string
}

/**
 * Runs the add through `runConcurrently` (a single-item list) for a live
 * spinner/elapsed-time display while cloning/fetching — but, unlike a batch
 * command, re-throws the raw error on failure rather than reporting it, to
 * preserve this project's existing "let it propagate to the top-level
 * handler" contract for a single operation.
 */
export async function runAdd(ctx: AppContext, source: string, options: AddOptions): Promise<AddResult> {
  const scope = resolveRepoScope(ctx, options)
  const repoCtx = { reposRoot: ctx.reposRoot, repoRegistryPath: scope.registryPath }

  const [outcome] = await runConcurrently([
    {
      name: defaultAlias(source),
      call: (report: TaskReporter) => {
        report.log(`cloning/fetching ${source}...`)
        return addRepoSourceOrAlias(repoCtx, source, { alias: options.as })
      },
    },
  ])

  if (outcome?.value === undefined) {
    throw outcome?.cancelled ? new SporkError('Cancelled.') : outcome?.error
  }
  return { entry: outcome.value, scopeLabel: describeRepoScope(scope) }
}

export function registerAddCommand(program: Command, ctx: AppContext): void {
  program
    .command('add <source>')
    .description('Clone (or refresh) a repo source and register an alias for it')
    .option('--as <alias>', 'alias to register (default: derived from the repo name)')
    .option('--global', 'register globally instead of the context-sensitive default')
    .option('--local', 'register locally (requires being inside a workspace)')
    .action(async (source: string, options: AddOptions) => {
      const { entry, scopeLabel } = await runAdd(ctx, source, options)
      console.log(ctx.ui.color.green(`"${entry.alias}" -> ${entry.source} (${scopeLabel})`))
    })
}
