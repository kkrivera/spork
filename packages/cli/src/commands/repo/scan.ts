import path from 'node:path'
import { adoptLocalRepo, findGitRepoDirs, type ScanResult } from '@spork/core'
import type { Command } from 'commander'
import { runConcurrently } from '../../concurrentTasks.js'
import type { AppContext } from '../../context.js'
import { describeRepoScope, resolveRepoScope, type RepoScopeOptions } from '../../repoScope.js'

export type ScanOptions = RepoScopeOptions

export interface ScanCommandResult {
  result: ScanResult
  scopeLabel: string
}

/**
 * Bulk-adopts every git repo found directly under `directory` (e.g. an
 * existing `~/code` folder) into spork's managed cache, concurrently, with
 * a live dashboard (`runConcurrently`) — see `@spork/core`'s
 * `adoptLocalRepo` for the clone/identity mechanics per repo. Defaults
 * `directory` to the current working directory, same as every other spork
 * command that accepts a directory without requiring one.
 */
export async function runScan(
  ctx: AppContext,
  directory: string = process.cwd(),
  options: ScanOptions = {},
): Promise<ScanCommandResult> {
  const scope = resolveRepoScope(ctx, options)
  const repoCtx = { reposRoot: ctx.reposRoot, repoRegistryPath: scope.registryPath }

  const dirs = await findGitRepoDirs(directory)
  const outcomes = await runConcurrently(
    dirs.map((dir) => ({ name: path.basename(dir), call: () => adoptLocalRepo(repoCtx, dir) })),
  )

  const result: ScanResult = { added: [], skipped: [] }
  outcomes.forEach((outcome, index) => {
    if (outcome.value) {
      result.added.push(outcome.value)
    } else {
      result.skipped.push({ path: dirs[index] as string, reason: outcome.cancelled ? 'cancelled' : (outcome.errorMessage ?? 'failed') })
    }
  })

  return { result, scopeLabel: describeRepoScope(scope) }
}

export function registerScanCommand(program: Command, ctx: AppContext): void {
  program
    .command('scan [directory]')
    .description('Bulk-adopt every git repo found directly under a folder (default: cwd; e.g. an existing ~/code)')
    .option('--global', 'register globally instead of the context-sensitive default')
    .option('--local', 'register locally (requires being inside a workspace)')
    .action(async (directory: string | undefined, options: ScanOptions) => {
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
