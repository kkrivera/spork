import { addRepoSourceOrAlias, type RepoRegistryEntry } from '@spork/core'
import type { Command } from 'commander'
import type { AppContext } from '../../context.js'
import { describeRepoScope, resolveRepoScope, type RepoScopeOptions } from '../../repoScope.js'

export interface AddOptions extends RepoScopeOptions {
  as?: string
}

export interface AddResult {
  entry: RepoRegistryEntry
  scopeLabel: string
}

export async function runAdd(ctx: AppContext, source: string, options: AddOptions): Promise<AddResult> {
  const scope = resolveRepoScope(ctx, options)
  const entry = await addRepoSourceOrAlias({ reposRoot: ctx.reposRoot, repoRegistryPath: scope.registryPath }, source, {
    alias: options.as,
  })
  return { entry, scopeLabel: describeRepoScope(scope) }
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
