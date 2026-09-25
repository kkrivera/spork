import { listRepoAliases, type RepoRegistryEntry } from '@spork/core'
import type { Command } from 'commander'
import type { AppContext } from '../../context.js'
import { formatTable } from '../../output/format.js'

export async function runList(ctx: AppContext): Promise<RepoRegistryEntry[]> {
  return listRepoAliases(ctx.repoRegistryPath, ctx.reposRoot)
}

export function registerListCommand(program: Command, ctx: AppContext): void {
  program
    .command('list')
    .description('List known repo aliases')
    .action(async () => {
      const repos = await runList(ctx)

      if (repos.length === 0) {
        console.log('No repos yet. Add one with: spork repo add <source>')
        return
      }

      console.log(formatTable(['ALIAS', 'SOURCE'], repos.map((repo) => [repo.alias, repo.source])))
    })
}
