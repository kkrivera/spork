import { listWorkspaces, removeWorkspace, resolveWorkspaceDir, unregisterWorkspace } from '@spork/core'
import type { Command } from 'commander'
import type { AppContext } from '../../context.js'

export interface RemoveOptions {
  keepFiles?: boolean
}

export async function runRemove(ctx: AppContext, workspace: string, options: RemoveOptions): Promise<void> {
  const dir = await resolveWorkspaceDir(ctx.registryPath, workspace)
  await removeWorkspace({ reposRoot: ctx.reposRoot }, dir, { keepFiles: options.keepFiles })

  const registered = await listWorkspaces(ctx.registryPath)
  const match = registered.find((entry) => entry.dir === dir)
  if (match) await unregisterWorkspace(ctx.registryPath, match.name)
}

export function registerRemoveCommand(program: Command, ctx: AppContext): void {
  program
    .command('remove <workspace>')
    .description('Remove a workspace')
    .option('--keep-files', 'forget the workspace without touching its files')
    .action(async (workspace: string, options: RemoveOptions) => {
      await runRemove(ctx, workspace, options)
      console.log(ctx.ui.color.green(`Removed workspace "${workspace}"`))
    })
}
