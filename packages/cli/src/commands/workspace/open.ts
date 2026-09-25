import { codeWorkspaceFilePath, reconcileWorkspace, resolveWorkspaceDir } from '@spork/core'
import type { Command } from 'commander'
import { workspaceContext, type AppContext } from '../../context.js'
import { createCodeOpener, type Opener } from '../../opener.js'

export interface OpenResult {
  filePath: string
  opened: boolean
  reason?: string
}

export async function runOpen(ctx: AppContext, workspace: string, opener: Opener): Promise<OpenResult> {
  const dir = await resolveWorkspaceDir(ctx.registryPath, workspace)
  const { manifest } = await reconcileWorkspace(workspaceContext(ctx), dir)
  const filePath = codeWorkspaceFilePath(dir, manifest.name)
  const outcome = await opener.open(filePath)

  return { filePath, opened: outcome.ok, reason: outcome.reason }
}

export function registerOpenCommand(program: Command, ctx: AppContext, opener: Opener = createCodeOpener()): void {
  program
    .command('open <workspace>')
    .description('Open a workspace in VS Code')
    .action(async (workspace: string) => {
      const result = await runOpen(ctx, workspace, opener)

      if (result.opened) {
        console.log(ctx.ui.color.green(`Opened ${result.filePath}`))
      } else {
        console.log(`Couldn't launch the "code" CLI (${result.reason}). Open manually: ${result.filePath}`)
      }
    })
}
