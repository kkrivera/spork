import { listWorkspaces, type RegistryEntry } from '@spork/core'
import type { Command } from 'commander'
import type { AppContext } from '../../context.js'
import { formatTable } from '../../output/format.js'

export async function runList(ctx: AppContext): Promise<RegistryEntry[]> {
  return listWorkspaces(ctx.registryPath)
}

export function registerListCommand(program: Command, ctx: AppContext): void {
  program
    .command('list')
    .description('List known workspaces')
    .action(async () => {
      const workspaces = await runList(ctx)

      if (workspaces.length === 0) {
        console.log('No workspaces yet. Create one with: spork workspace create <name>')
        return
      }

      console.log(formatTable(['NAME', 'DIR'], workspaces.map((workspace) => [workspace.name, workspace.dir])))
    })
}
