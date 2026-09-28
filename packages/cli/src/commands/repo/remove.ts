import { removeLocalRepoAlias, removeRepoSource } from '@spork/core'
import type { Command } from 'commander'
import { removeRepoSourceContext, type AppContext } from '../../context.js'
import { describeRepoScope, resolveRepoScope, type RepoScopeOptions } from '../../repoScope.js'

export type RemoveOptions = RepoScopeOptions

export async function runRemove(ctx: AppContext, alias: string, options: RemoveOptions): Promise<string> {
  const scope = resolveRepoScope(ctx, options)
  const removeCtx = removeRepoSourceContext(ctx)

  if (scope.scope === 'local') {
    await removeLocalRepoAlias(removeCtx, scope.workspaceDir as string, alias)
  } else {
    await removeRepoSource(removeCtx, alias)
  }

  return describeRepoScope(scope)
}

export function registerRemoveCommand(program: Command, ctx: AppContext): void {
  program
    .command('remove <alias>')
    .description('Remove a repo alias and its cache (refuses if a workspace still uses it)')
    .option('--global', 'remove globally instead of the context-sensitive default')
    .option('--local', 'remove locally (requires being inside a workspace)')
    .action(async (alias: string, options: RemoveOptions) => {
      const scopeLabel = await runRemove(ctx, alias, options)
      console.log(ctx.ui.color.green(`Removed "${alias}" (${scopeLabel})`))
    })
}
