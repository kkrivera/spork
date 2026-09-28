import { findEnclosingWorkspaceDir, listRepoAliases, localRepoRegistryPath, SporkError, type RepoRegistryEntry } from '@spork/core'
import type { Command } from 'commander'
import type { AppContext } from '../../context.js'
import { formatTable } from '../../output/format.js'
import type { RepoScopeOptions } from '../../repoScope.js'

export interface ScopedRepoEntry extends RepoRegistryEntry {
  scope: 'local' | 'global'
}

/**
 * Unlike add/remove (which resolve to exactly one destination scope), list
 * defaults to a merged view: local entries (if cwd is inside a workspace)
 * plus global ones, each tagged, so a shadowed alias is visible rather than
 * a silent surprise. --global/--local narrow to just one.
 */
export async function runList(
  ctx: AppContext,
  options: RepoScopeOptions = {},
  cwd: string = process.cwd(),
): Promise<ScopedRepoEntry[]> {
  if (options.global && options.local) {
    throw new SporkError('Pass either --global or --local, not both.')
  }

  const workspaceDir = findEnclosingWorkspaceDir(cwd)
  if (options.local && !workspaceDir) {
    throw new SporkError('Not inside a workspace — pass --global, or run this from inside one.')
  }

  const entries: ScopedRepoEntry[] = []

  if (!options.global && workspaceDir) {
    const local = await listRepoAliases(localRepoRegistryPath(workspaceDir), ctx.reposRoot)
    entries.push(...local.map((repo) => ({ ...repo, scope: 'local' as const })))
  }

  if (!options.local) {
    const global = await listRepoAliases(ctx.repoRegistryPath, ctx.reposRoot)
    entries.push(...global.map((repo) => ({ ...repo, scope: 'global' as const })))
  }

  return entries
}

export function registerListCommand(program: Command, ctx: AppContext): void {
  program
    .command('list')
    .description('List known repo aliases (local + global by default)')
    .option('--global', 'only global aliases')
    .option('--local', 'only local aliases (requires being inside a workspace)')
    .action(async (options: RepoScopeOptions) => {
      const repos = await runList(ctx, options)

      if (repos.length === 0) {
        console.log('No repos yet. Add one with: spork repo add <source>')
        return
      }

      console.log(formatTable(['ALIAS', 'SOURCE', 'SCOPE'], repos.map((repo) => [repo.alias, repo.source, repo.scope])))
    })
}
