import { addRepo, resolveWorkspaceDir, type AddRepoResult } from '@spork/core'
import type { Command } from 'commander'
import type { AppContext } from '../../context.js'

export interface AddRepoOptions {
  branch?: string
  as?: string
}

export async function runAddRepo(
  ctx: AppContext,
  workspace: string,
  source: string,
  options: AddRepoOptions,
): Promise<AddRepoResult> {
  const dir = await resolveWorkspaceDir(ctx.registryPath, workspace)
  return addRepo({ reposRoot: ctx.reposRoot }, dir, { source, ref: options.branch, folder: options.as })
}

export function registerAddRepoCommand(program: Command, ctx: AppContext): void {
  program
    .command('add-repo <workspace> <source>')
    .description('Add a repo to a workspace as an isolated git worktree')
    .option('--branch <ref>', "branch/tag/sha to check out (default: the repo's default branch)")
    .option('--as <folder>', 'folder name to use (default: derived from the repo name)')
    .action(async (workspace: string, source: string, options: AddRepoOptions) => {
      const result = await runAddRepo(ctx, workspace, source, options)
      const { entry } = result

      console.log(ctx.ui.color.green(`Added "${entry.folder}" (${entry.localBranch}) to workspace "${workspace}"`))

      if (result.submodulesInitialized) {
        console.log(`Initialized submodules in "${entry.folder}"`)
      } else if (result.submoduleWarning) {
        console.log(
          ctx.ui.color.yellow(
            `Warning: "${entry.folder}" has submodules but initializing them failed: ${result.submoduleWarning}`,
          ),
        )
      }
    })
}
