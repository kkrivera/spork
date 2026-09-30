import { scanAndAddRepos, type ScanResult } from '@spork/core'
import type { Command } from 'commander'
import type { AppContext } from '../../context.js'
import { describeRepoScope, resolveRepoScope, type RepoScopeOptions } from '../../repoScope.js'

export type ScanOptions = RepoScopeOptions

export interface ScanCommandResult {
  result: ScanResult
  scopeLabel: string
}

/**
 * Bulk-adopts every git repo found directly under `directory` (e.g. an
 * existing `~/code` folder) into spork's managed cache — see
 * `@spork/core`'s `scanAndAddRepos` for the clone/identity mechanics.
 */
export async function runScan(ctx: AppContext, directory: string, options: ScanOptions): Promise<ScanCommandResult> {
  const scope = resolveRepoScope(ctx, options)
  const result = await scanAndAddRepos({ reposRoot: ctx.reposRoot, repoRegistryPath: scope.registryPath }, directory)
  return { result, scopeLabel: describeRepoScope(scope) }
}

export function registerScanCommand(program: Command, ctx: AppContext): void {
  program
    .command('scan <directory>')
    .description('Bulk-adopt every git repo found directly under a folder (e.g. an existing ~/code)')
    .option('--global', 'register globally instead of the context-sensitive default')
    .option('--local', 'register locally (requires being inside a workspace)')
    .action(async (directory: string, options: ScanOptions) => {
      const { result, scopeLabel } = await runScan(ctx, directory, options)

      for (const entry of result.added) {
        console.log(ctx.ui.color.green(`"${entry.alias}" -> ${entry.source} (${scopeLabel})`))
      }
      for (const skip of result.skipped) {
        console.log(ctx.ui.color.yellow(`Skipped ${skip.path}: ${skip.reason}`))
      }
      console.log(`${result.added.length} added, ${result.skipped.length} skipped.`)
    })
}
