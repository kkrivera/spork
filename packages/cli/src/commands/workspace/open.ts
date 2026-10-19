import { codeWorkspaceFilePath, reconcileWorkspace, resolveWorkspaceDir } from '@spork/core'
import type { Command } from 'commander'
import { workspaceContext, type AppContext } from '../../context.js'
import { createCodeOpener, type Opener } from '../../opener.js'
import { pickWorkspaceName } from './pickWorkspace.js'

export interface OpenResult {
  filePath: string
  opened: boolean
  reason?: string
}

export async function runOpen(ctx: AppContext, workspace: string | undefined, opener: Opener): Promise<OpenResult> {
  const name =
    workspace ??
    (await pickWorkspaceName(
      ctx,
      'Select a workspace to open',
      'Multiple workspaces are registered — pass one explicitly: spork workspace open <name>',
    ))
  const dir = await resolveWorkspaceDir(ctx.registryPath, name)
  const { manifest } = await reconcileWorkspace(workspaceContext(ctx), dir)
  const filePath = codeWorkspaceFilePath(dir, manifest.name)
  const outcome = await opener.open(filePath)

  return { filePath, opened: outcome.ok, reason: outcome.reason }
}

export function registerOpenCommand(program: Command, ctx: AppContext, opener: Opener = createCodeOpener()): void {
  program
    .command('open [workspace]')
    .description('Open a workspace in VS Code (omit the name to pick from a list)')
    .action(async (workspace: string | undefined) => {
      const result = await runOpen(ctx, workspace, opener)

      if (result.opened) {
        console.log(ctx.ui.color.green(`Opened ${result.filePath}`))
      } else {
        console.log(`Couldn't launch the "code" CLI (${result.reason}). Open manually: ${result.filePath}`)
      }
    })
}
