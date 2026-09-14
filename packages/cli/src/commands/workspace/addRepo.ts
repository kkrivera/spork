import { addRepo, resolveWorkspaceDir, type WorktreeEntry } from '@spork/core'
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
): Promise<WorktreeEntry> {
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
      const entry = await runAddRepo(ctx, workspace, source, options)
      console.log(ctx.ui.color.green(`Added "${entry.folder}" (${entry.localBranch}) to workspace "${workspace}"`))
    })
}
