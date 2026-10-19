import { getWorkspaceStatus, resolveWorkspaceDir, SporkError, type WorktreeStatusEntry } from '@spork/core'
import type { TaskReporter } from '@spork/task-runner'
import type { Command } from 'commander'
import { runConcurrently } from '../../concurrentTasks.js'
import { workspaceContext, type AppContext } from '../../context.js'
import { formatTable } from '../../output/format.js'
import { pickWorkspaceName } from './pickWorkspace.js'

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
export async function runStatus(ctx: AppContext, workspace: string | undefined): Promise<WorktreeStatusEntry[]> {
  const name =
    workspace ??
    (await pickWorkspaceName(
      ctx,
      'Select a workspace',
      'Multiple workspaces are registered — pass one explicitly: spork workspace status <name>',
    ))
  const dir = await resolveWorkspaceDir(ctx.registryPath, name)
  const [outcome] = await runConcurrently([
    {
      name,
      call: (report: TaskReporter) => {
        report.log('reading git status...')
        return getWorkspaceStatus(workspaceContext(ctx), dir)
      },
    },
  ])

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
    .command('status [workspace]')
    .description('Show local status for every worktree in a workspace (omit to pick from a list)')
    .action(async (workspace: string | undefined) => {
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
