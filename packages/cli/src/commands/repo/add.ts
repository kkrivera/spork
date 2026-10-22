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
 * Whether a person is at a real terminal that git/ssh can prompt on. Only
 * then does a single `repo add` hand the terminal over to git instead of
 * the live dashboard (see `runAdd`).
 */
export function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true
}

/**
 * In an interactive terminal, calls core directly with prompts allowed and
 * no live dashboard: git/ssh print an SSH passphrase/HTTPS password/host-key
 * prompt straight to the terminal, and the dashboard's redraw would erase
 * it the moment it appeared, leaving what looks like a hang. A single add
 * is one clone or fetch, so that's one prompt at most.
 *
 * Otherwise (CI, a pipe), runs the add through `runConcurrently` (a
 * single-item list) for a spinner/elapsed-time display or its streamed-line
 * fallback, with prompts left off so an auth failure errors immediately
 * with what to do next rather than hanging. Either way, re-throws the raw
 * error on failure rather than reporting it, to preserve this project's
 * existing "let it propagate to the top-level handler" contract for a
 * single operation.
 */
export async function runAdd(ctx: AppContext, source: string, options: AddOptions, interactive = false): Promise<AddResult> {
  const scope = resolveRepoScope(ctx, options)
  const repoCtx = { reposRoot: ctx.reposRoot, repoRegistryPath: scope.registryPath }

  if (interactive) {
    const entry = await addRepoSourceOrAlias(repoCtx, source, { alias: options.as, allowPrompts: true })
    return { entry, scopeLabel: describeRepoScope(scope) }
  }

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

export function registerAddCommand(program: Command, ctx: AppContext, isInteractive: () => boolean = isInteractiveTerminal): void {
  program
    .command('add <source>')
    .description('Clone (or refresh) a repo source and register an alias for it')
    .option('--as <alias>', 'alias to register (default: derived from the repo name)')
    .option('--global', 'register globally instead of the context-sensitive default')
    .option('--local', 'register locally (requires being inside a workspace)')
    .action(async (source: string, options: AddOptions) => {
      const interactive = isInteractive()
      if (interactive) console.log(`Cloning/fetching ${source}... (git may ask for your SSH passphrase or password)`)
      const { entry, scopeLabel } = await runAdd(ctx, source, options, interactive)
      console.log(ctx.ui.color.green(`"${entry.alias}" -> ${entry.source} (${scopeLabel})`))
    })
}
