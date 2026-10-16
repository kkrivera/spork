import { addRepo, defaultAlias, resolveWorkspaceDir, SporkError, type AddRepoResult } from '@spork/core'
import type { TaskReporter } from '@spork/task-runner'
import type { Command } from 'commander'
import { runConcurrently } from '../../concurrentTasks.js'
import { workspaceContext, type AppContext } from '../../context.js'

export interface AddRepoOptions {
  branch?: string
  as?: string
  /** Register the repo's alias globally instead of locally to this workspace (the default). */
  global?: boolean
}

/**
 * Runs the add through `runConcurrently` (a single-item list) so it gets a
 * live spinner/elapsed-time display while cloning/fetching, same as every
 * other wired command — but, unlike a batch command, re-throws the raw
 * error on failure rather than reporting it, to preserve this project's
 * existing "let it propagate to the top-level handler" contract for a
 * single operation.
 */
export async function runAddRepo(
  ctx: AppContext,
  workspace: string,
  source: string,
  options: AddRepoOptions,
): Promise<AddRepoResult> {
  const dir = await resolveWorkspaceDir(ctx.registryPath, workspace)
  const [outcome] = await runConcurrently([
    {
      name: defaultAlias(source),
      call: (report: TaskReporter) => {
        report.log(`cloning/fetching ${source}...`)
        return addRepo(workspaceContext(ctx), dir, {
          source,
          ref: options.branch,
          folder: options.as,
          global: options.global,
        })
      },
    },
  ])

  if (outcome?.value === undefined) {
    throw outcome?.cancelled ? new SporkError('Cancelled.') : outcome?.error
  }
  return outcome.value
}

/** Prints an AddRepoResult the same way regardless of whether it came from `add-repo` or `create --repo`. */
export function printAddRepoResult(ctx: AppContext, workspace: string, result: AddRepoResult): void {
  const { entry } = result
  console.log(
    ctx.ui.color.green(
      `Added "${entry.folder}" (${entry.localBranch}) to workspace "${workspace}" (alias: ${result.aliasScope})`,
    ),
  )

  if (result.reusedExistingBranch) {
    console.log(ctx.ui.color.dim(`Reused existing branch "${entry.localBranch}" for "${entry.folder}".`))
  }

  if (result.submodulesInitialized) {
    console.log(`Initialized submodules in "${entry.folder}"`)
  } else if (result.submoduleWarning) {
    console.log(
      ctx.ui.color.yellow(
        `Warning: "${entry.folder}" has submodules but initializing them failed: ${result.submoduleWarning}`,
      ),
    )
  }
}

export function registerAddRepoCommand(program: Command, ctx: AppContext): void {
  program
    .command('add-repo <workspace> <source>')
    .description('Add a repo to a workspace as an isolated git worktree')
    .option('--branch <ref>', "branch/tag/sha to check out (default: the repo's default branch)")
    .option('--as <folder>', 'folder name to use (default: derived from the repo name)')
    .option('--global', "register the repo's alias globally instead of locally to this workspace")
    .action(async (workspace: string, source: string, options: AddRepoOptions) => {
      const result = await runAddRepo(ctx, workspace, source, options)
      printAddRepoResult(ctx, workspace, result)
    })
}
