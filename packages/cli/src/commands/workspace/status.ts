import { getWorkspaceStatus, resolveWorkspaceDir, type WorktreeStatusEntry } from '@spork/core'
import type { Command } from 'commander'
import { workspaceContext, type AppContext } from '../../context.js'
import { formatTable } from '../../output/format.js'

export async function runStatus(ctx: AppContext, workspace: string): Promise<WorktreeStatusEntry[]> {
  const dir = await resolveWorkspaceDir(ctx.registryPath, workspace)
  return getWorkspaceStatus(workspaceContext(ctx), dir)
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
