import { listWorkspacesByRecentUse, readManifest, type RecentWorkspace } from '@spork/core'
import type { Command } from 'commander'
import type { AppContext } from '../../context.js'
import { formatTable } from '../../output/format.js'
import { workspaceLocation } from '../../output/paths.js'
import { describeActivity } from '../../output/timeAgo.js'

export interface WorkspaceListEntry extends RecentWorkspace {
  /** How many repos the workspace's manifest lists, or null if it couldn't be read. */
  repos: number | null
}

export interface ListOptions {
  /** Show every workspace's full absolute path instead of the folder it sits in. */
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
  const workspaces = await listWorkspacesByRecentUse(ctx.registryPath)
  return Promise.all(workspaces.map(async (workspace) => ({ ...workspace, repos: await repoCount(workspace.dir) })))
}

/**
 * NAME, REPOS, ACTIVITY ("Last used 3 hours ago" or "Created 2 days
 * ago", see `describeActivity`) and LOCATION (the folder each one sits
 * in — see `workspaceLocation`). `--paths` swaps LOCATION for a PATH
 * column of every workspace's full, unshortened directory.
 */
export function formatWorkspaceList(workspaces: readonly WorkspaceListEntry[], options: ListOptions, now: Date = new Date()): string {
  const repos = (workspace: WorkspaceListEntry): string => (workspace.repos === null ? '?' : String(workspace.repos))
  const where = options.paths ? 'PATH' : 'LOCATION'
  return formatTable(
    ['NAME', 'REPOS', 'ACTIVITY', where],
    workspaces.map((workspace) => [
      workspace.name,
      repos(workspace),
      describeActivity(workspace.lastActivity, now),
      options.paths ? workspace.dir : workspaceLocation(workspace),
    ]),
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

      console.log(formatWorkspaceList(workspaces, options))
    })
}
