import { addRepoSourceOrAlias, type RepoRegistryEntry } from '@spork/core'
import type { Command } from 'commander'
import { repoContext, type AppContext } from '../../context.js'

export interface AddOptions {
  as?: string
}

export async function runAdd(ctx: AppContext, source: string, options: AddOptions): Promise<RepoRegistryEntry> {
  return addRepoSourceOrAlias(repoContext(ctx), source, { alias: options.as })
}

export function registerAddCommand(program: Command, ctx: AppContext): void {
  program
    .command('add <source>')
    .description('Clone (or refresh) a repo source and register an alias for it')
    .option('--as <alias>', 'alias to register (default: derived from the repo name)')
    .action(async (source: string, options: AddOptions) => {
      const entry = await runAdd(ctx, source, options)
      console.log(ctx.ui.color.green(`"${entry.alias}" -> ${entry.source}`))
    })
}
