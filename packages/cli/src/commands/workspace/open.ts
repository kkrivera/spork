import { codeWorkspaceFilePath, listWorkspaces, reconcileWorkspace, resolveWorkspaceDir, SporkError } from '@spork/core'
import { NotInteractiveError, select, type PromptOption } from '@spork/prompts'
import type { Command } from 'commander'
import { workspaceContext, type AppContext } from '../../context.js'
import { createCodeOpener, type Opener } from '../../opener.js'

export interface OpenResult {
  filePath: string
  opened: boolean
  reason?: string
}

/**
 * Lists every registered workspace and offers a single-select to pick one
 * to open — used when `open` is given no name. `select` throws
 * `NotInteractiveError` when it can't prompt (no TTY); there's no sensible
 * default to fall back to here (unlike `workspace create`'s empty-workspace
 * fallback), so that becomes a clear `SporkError` asking for the name
 * explicitly instead. A real cancel (Esc/Ctrl+C) becomes `SporkError`'s
 * usual `'Cancelled.'`, same as every other cancelled-prompt path here.
 */
async function pickWorkspaceDir(ctx: AppContext): Promise<string> {
  const workspaces = await listWorkspaces(ctx.registryPath)
  if (workspaces.length === 0) {
    throw new SporkError('No workspaces yet. Create one with: spork workspace create <name>')
  }

  const options: PromptOption<string>[] = workspaces.map((workspace) => ({
    label: workspace.name,
    value: workspace.dir,
    hint: workspace.dir,
  }))

  let chosen: string[] | null
  try {
    chosen = await select({ message: 'Select a workspace to open', options, mode: 'single' })
  } catch (error) {
    if (error instanceof NotInteractiveError) {
      throw new SporkError('Multiple workspaces are registered — pass one explicitly: spork workspace open <name>')
    }
    throw error
  }

  if (chosen === null) throw new SporkError('Cancelled.')
  return chosen[0] as string
}

export async function runOpen(ctx: AppContext, workspace: string | undefined, opener: Opener): Promise<OpenResult> {
  const dir = workspace ? await resolveWorkspaceDir(ctx.registryPath, workspace) : await pickWorkspaceDir(ctx)
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
