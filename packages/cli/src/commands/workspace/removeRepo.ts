import { removeRepo, resolveWorkspaceDir } from '@spork/core'
import type { Command } from 'commander'
import type { AppContext } from '../../context.js'

export async function runRemoveRepo(ctx: AppContext, workspace: string, folder: string): Promise<void> {
  const dir = await resolveWorkspaceDir(ctx.registryPath, workspace)
  await removeRepo({ reposRoot: ctx.reposRoot }, dir, folder)
}

export function registerRemoveRepoCommand(program: Command, ctx: AppContext): void {
  program
    .command('remove-repo <workspace> <folder>')
    .description('Remove a repo (worktree) from a workspace')
    .action(async (workspace: string, folder: string) => {
      await runRemoveRepo(ctx, workspace, folder)
      console.log(ctx.ui.color.green(`Removed "${folder}" from workspace "${workspace}"`))
    })
}
