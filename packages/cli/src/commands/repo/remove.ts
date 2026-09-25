import { removeRepoSource } from '@spork/core'
import type { Command } from 'commander'
import { removeRepoSourceContext, type AppContext } from '../../context.js'

export async function runRemove(ctx: AppContext, alias: string): Promise<void> {
  await removeRepoSource(removeRepoSourceContext(ctx), alias)
}

export function registerRemoveCommand(program: Command, ctx: AppContext): void {
  program
    .command('remove <alias>')
    .description('Remove a repo alias and its cache (refuses if a workspace still uses it)')
    .action(async (alias: string) => {
      await runRemove(ctx, alias)
      console.log(ctx.ui.color.green(`Removed "${alias}"`))
    })
}
