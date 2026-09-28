import path from 'node:path'
import {
  createWorkspace,
  listWorkspaces,
  registerWorkspace,
  SporkError,
  type AddRepoResult,
  type WorkspaceHandle,
} from '@spork/core'
import type { Command } from 'commander'
import { workspaceContext, type AppContext } from '../../context.js'
import { printAddRepoResult, runAddRepo } from './addRepo.js'

export interface CreateOptions {
  dir?: string
  repo?: string[]
  /** Register each --repo's alias globally instead of locally to the new workspace (the default). */
  global?: boolean
}

function collectRepo(value: string, previous: string[]): string[] {
  return [...previous, value]
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

export interface CreateWithReposResult {
  handle: WorkspaceHandle
  addRepoResults: AddRepoResult[]
}

/**
 * Creates the workspace, then adds each `--repo` in order via the same
 * runAddRepo the standalone `add-repo` command uses. Fail-fast, not atomic:
 * if one repo fails, the already-created (and already-registered) workspace
 * is left as-is with whatever repos succeeded before it — recoverable via
 * `add-repo` for the rest.
 */
export async function runCreateWithRepos(
  ctx: AppContext,
  name: string,
  options: CreateOptions,
): Promise<CreateWithReposResult> {
  const handle = await runCreate(ctx, name, options)
  const addRepoResults: AddRepoResult[] = []

  for (const source of options.repo ?? []) {
    addRepoResults.push(await runAddRepo(ctx, handle.name, source, { global: options.global }))
  }

  return { handle, addRepoResults }
}

export function registerCreateCommand(program: Command, ctx: AppContext): void {
  program
    .command('create <name>')
    .description('Create a new workspace')
    .option('--dir <path>', 'directory to create the workspace in (default: ./<name>)')
    .option('--repo <source>', 'repo to add (repeatable)', collectRepo, [] as string[])
    .option('--global', "register each --repo's alias globally instead of locally to this workspace")
    .action(async (name: string, options: CreateOptions) => {
      const { handle, addRepoResults } = await runCreateWithRepos(ctx, name, options)
      console.log(ctx.ui.color.green(`Created workspace "${handle.name}" at ${handle.dir}`))

      if (addRepoResults.length === 0) {
        console.log(`Add a repo with: spork workspace add-repo ${handle.name} <repo>`)
        return
      }

      for (const result of addRepoResults) {
        printAddRepoResult(ctx, handle.name, result)
      }
    })
}
