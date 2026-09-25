import path from 'node:path'
import { createWorkspace, listWorkspaces, registerWorkspace, SporkError, type WorkspaceHandle } from '@spork/core'
import type { Command } from 'commander'
import { workspaceContext, type AppContext } from '../../context.js'

export interface CreateOptions {
  dir?: string
}

export async function runCreate(ctx: AppContext, name: string, options: CreateOptions): Promise<WorkspaceHandle> {
  const existing = await listWorkspaces(ctx.registryPath)
  if (existing.some((workspace) => workspace.name === name)) {
    throw new SporkError(`A workspace named "${name}" is already registered.`)
  }

  const dir = options.dir ? path.resolve(options.dir) : path.resolve(process.cwd(), name)
  const handle = await createWorkspace(workspaceContext(ctx), { name, dir })
  await registerWorkspace(ctx.registryPath, { name, dir })

  return handle
}

export function registerCreateCommand(program: Command, ctx: AppContext): void {
  program
    .command('create <name>')
    .description('Create a new workspace')
    .option('--dir <path>', 'directory to create the workspace in (default: ./<name>)')
    .action(async (name: string, options: CreateOptions) => {
      const handle = await runCreate(ctx, name, options)
      console.log(ctx.ui.color.green(`Created workspace "${handle.name}" at ${handle.dir}`))
      console.log(`Add a repo with: spork workspace add-repo ${handle.name} <repo>`)
    })
}
