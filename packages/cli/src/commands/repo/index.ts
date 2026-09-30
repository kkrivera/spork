import type { Command } from 'commander'
import type { AppContext } from '../../context.js'
import { registerAddCommand } from './add.js'
import { registerListCommand } from './list.js'
import { registerRemoveCommand } from './remove.js'
import { registerScanCommand } from './scan.js'

export function registerRepoCommands(program: Command, ctx: AppContext): void {
  const repo = program.command('repo').description('Manage the repo cache, independent of any workspace')

  registerAddCommand(repo, ctx)
  registerListCommand(repo, ctx)
  registerRemoveCommand(repo, ctx)
  registerScanCommand(repo, ctx)
}
