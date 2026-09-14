import type { Command } from 'commander'
import type { AppContext } from '../../context.js'
import { registerAddRepoCommand } from './addRepo.js'
import { registerCreateCommand } from './create.js'
import { registerListCommand } from './list.js'
import { registerOpenCommand } from './open.js'
import { registerRemoveCommand } from './remove.js'
import { registerRemoveRepoCommand } from './removeRepo.js'
import { registerStatusCommand } from './status.js'

export function registerWorkspaceCommands(program: Command, ctx: AppContext): void {
  const workspace = program.command('workspace').description('Manage git-worktree workspaces')

  registerCreateCommand(workspace, ctx)
  registerAddRepoCommand(workspace, ctx)
  registerRemoveRepoCommand(workspace, ctx)
  registerRemoveCommand(workspace, ctx)
  registerListCommand(workspace, ctx)
  registerStatusCommand(workspace, ctx)
  registerOpenCommand(workspace, ctx)
}
