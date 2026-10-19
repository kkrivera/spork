import { listWorkspaces, SporkError } from '@spork/core'
import { NotInteractiveError, select, type PromptOption } from '@spork/prompts'
import type { AppContext } from '../../context.js'

async function pickableWorkspaces(ctx: AppContext): Promise<PromptOption<string>[]> {
  const workspaces = await listWorkspaces(ctx.registryPath)
  if (workspaces.length === 0) {
    throw new SporkError('No workspaces yet. Create one with: spork workspace create <name>')
  }
  return workspaces.map((workspace) => ({ label: workspace.name, value: workspace.name, hint: workspace.dir }))
}

/**
 * Offers a single-select of every registered workspace's name — used by any
 * `workspace <verb>` command whose workspace argument was omitted. `select`
 * throws `NotInteractiveError` when it can't prompt (no TTY); there's no
 * sensible default to fall back to, so that becomes a clear `SporkError`
 * naming the explicit-argument form instead. A real cancel (Esc/Ctrl+C)
 * becomes `SporkError`'s usual `'Cancelled.'`, same as every other
 * cancelled-prompt path in this CLI.
 */
export async function pickWorkspaceName(ctx: AppContext, message: string, usageHint: string): Promise<string> {
  const options = await pickableWorkspaces(ctx)

  let chosen: string[] | null
  try {
    chosen = await select({ message, options, mode: 'single' })
  } catch (error) {
    if (error instanceof NotInteractiveError) throw new SporkError(usageHint)
    throw error
  }

  if (chosen === null) throw new SporkError('Cancelled.')
  return chosen[0] as string
}

/** Same as `pickWorkspaceName`, but a multi-select — for a command that can act on several workspaces at once. */
export async function pickWorkspaceNames(ctx: AppContext, message: string, usageHint: string): Promise<string[]> {
  const options = await pickableWorkspaces(ctx)

  let chosen: string[] | null
  try {
    chosen = await select({ message, options, mode: 'multi', minSelected: 1 })
  } catch (error) {
    if (error instanceof NotInteractiveError) throw new SporkError(usageHint)
    throw error
  }

  if (chosen === null) throw new SporkError('Cancelled.')
  return chosen
}
