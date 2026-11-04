import { listWorkspaces, readManifest, type RegistryEntry } from '@spork/core'
import type { Command } from 'commander'
import type { AppContext } from '../../context.js'
import { formatTable } from '../../output/format.js'
import { workspaceLocation } from '../../output/paths.js'

export interface WorkspaceListEntry extends RegistryEntry {
  /** How many repos the workspace's manifest lists, or null if it couldn't be read. */
  repos: number | null
}

export interface ListOptions {
  /** Show every workspace's full absolute path instead of only the unusual ones, shortened. */
  paths?: boolean
}

async function repoCount(dir: string): Promise<number | null> {
  try {
    return (await readManifest(dir)).worktrees.length
  } catch {
    return null
  }
}

export async function runList(ctx: AppContext): Promise<WorkspaceListEntry[]> {
  const workspaces = await listWorkspaces(ctx.registryPath)
  return Promise.all(workspaces.map(async (workspace) => ({ ...workspace, repos: await repoCount(workspace.dir) })))
}

/**
 * NAME and REPOS, plus a LOCATION column only for workspaces that aren't
 * at `SPORK_WORKSPACE_DIR/<name>` (see `workspaceLocation`) — left out
 * entirely when there are none. `--paths` swaps that for a PATH column of
 * every workspace's full, unshortened directory.
 */
export function formatWorkspaceList(
  workspaces: readonly WorkspaceListEntry[],
  defaultParent: string | undefined,
  options: ListOptions,
): string {
  const repos = (workspace: WorkspaceListEntry): string => (workspace.repos === null ? '?' : String(workspace.repos))
  if (options.paths) {
    return formatTable(['NAME', 'REPOS', 'PATH'], workspaces.map((workspace) => [workspace.name, repos(workspace), workspace.dir]))
  }

  const locations = workspaces.map((workspace) => workspaceLocation(workspace, defaultParent))
  if (locations.every((location) => location === null)) {
    return formatTable(['NAME', 'REPOS'], workspaces.map((workspace) => [workspace.name, repos(workspace)]))
  }
  return formatTable(
    ['NAME', 'REPOS', 'LOCATION'],
    workspaces.map((workspace, i) => [workspace.name, repos(workspace), locations[i] ?? '']),
  )
}

export function registerListCommand(program: Command, ctx: AppContext): void {
  program
    .command('list')
    .description('List known workspaces')
    .option('--paths', "show every workspace's full path")
    .action(async (options: ListOptions) => {
      const workspaces = await runList(ctx)

      if (workspaces.length === 0) {
        console.log('No workspaces yet. Create one with: spork workspace create <name>')
        return
      }

      console.log(formatWorkspaceList(workspaces, ctx.env.workspaceDir, options))
    })
}
