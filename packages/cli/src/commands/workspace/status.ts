import { getWorkspaceStatus, resolveWorkspaceDir, SporkError, type WorktreeStatusEntry } from '@spork/core'
import type { Command } from 'commander'
import { runConcurrently } from '../../concurrentTasks.js'
import { workspaceContext, type AppContext } from '../../context.js'
import { formatTable } from '../../output/format.js'

/**
 * Runs the (already internally concurrent — `getWorkspaceStatus` reads every
 * worktree's status via its own `Promise.all`) status read through
 * `runConcurrently` as a single item, for a live spinner while it works
 * rather than a silent wait. Each worktree's `git status` read is fast
 * enough that per-worktree task granularity isn't worth a second core
 * export; one aggregate spinner for "reading status" is the simpler, honest
 * fit. Re-throws the raw error on failure, same as every other single-item
 * command wired this way.
 */
export async function runStatus(ctx: AppContext, workspace: string): Promise<WorktreeStatusEntry[]> {
  const dir = await resolveWorkspaceDir(ctx.registryPath, workspace)
  const [outcome] = await runConcurrently([{ name: workspace, call: () => getWorkspaceStatus(workspaceContext(ctx), dir) }])

  if (outcome?.value === undefined) {
    throw outcome?.cancelled ? new SporkError('Cancelled.') : outcome?.error
  }
  return outcome.value
}

function statusCell(entry: WorktreeStatusEntry): string {
  return entry.status.isClean ? 'clean' : `${entry.status.changedFiles} changed`
}

export function registerStatusCommand(program: Command, ctx: AppContext): void {
  program
    .command('status <workspace>')
    .description('Show local status for every worktree in a workspace')
    .action(async (workspace: string) => {
      const entries = await runStatus(ctx, workspace)

      if (entries.length === 0) {
        console.log('This workspace has no repos yet.')
        return
      }

      console.log(
        formatTable(
          ['FOLDER', 'BRANCH', 'STATUS'],
          entries.map((entry) => [entry.folder, entry.status.branch ?? '(detached)', statusCell(entry)]),
        ),
      )
    })
}
