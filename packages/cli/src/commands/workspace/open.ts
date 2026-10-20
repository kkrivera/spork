import { codeWorkspaceFilePath, reconcileWorkspace, resolveWorkspaceDir, SporkError } from '@spork/core'
import { NotInteractiveError, select } from '@spork/prompts'
import type { Command } from 'commander'
import { workspaceContext, type AppContext } from '../../context.js'
import { defaultLaunchDeps, LAUNCH_TARGET_OPTIONS, launchWorkspace, type LaunchDeps, type LaunchTarget } from '../../launchTarget.js'
import { pickWorkspaceName } from './pickWorkspace.js'

export interface OpenOptions {
  with?: LaunchTarget
}

export interface OpenResult {
  filePath: string
  dir: string
  target: LaunchTarget
  opened: boolean
  reason?: string
}

export function parseLaunchTarget(value: string): LaunchTarget {
  if (value !== 'code' && value !== 'claude') {
    throw new SporkError(`--with must be "code" or "claude", got "${value}".`)
  }
  return value
}

/**
 * Resolves which target to launch: an explicit `--with` always wins, no
 * prompt at all. Otherwise offers a single-select of VS Code/Claude —
 * unlike `create`'s optional offer, `open` was invoked specifically to
 * open something, so there's no sensible "skip" outcome here:
 * `NotInteractiveError` becomes a clear `SporkError` demanding `--with`,
 * and a real cancel (Esc) becomes `SporkError('Cancelled.')`, same as
 * every other mandatory picker in this CLI.
 */
async function resolveLaunchTarget(explicit: LaunchTarget | undefined): Promise<LaunchTarget> {
  if (explicit) return explicit

  let chosen: LaunchTarget[] | null
  try {
    chosen = await select({ message: 'Open with', options: LAUNCH_TARGET_OPTIONS, mode: 'single' })
  } catch (error) {
    if (error instanceof NotInteractiveError) {
      throw new SporkError('Pass --with <code|claude> — there is no interactive terminal to pick one from.')
    }
    throw error
  }

  if (chosen === null) throw new SporkError('Cancelled.')
  return chosen[0] as LaunchTarget
}

export async function runOpen(
  ctx: AppContext,
  workspace: string | undefined,
  options: OpenOptions,
  deps: LaunchDeps,
): Promise<OpenResult> {
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
  const target = await resolveLaunchTarget(options.with)
  const outcome = await launchWorkspace(target, dir, filePath, deps)

  return { filePath, dir, target, opened: outcome.ok, reason: outcome.reason }
}

export function registerOpenCommand(program: Command, ctx: AppContext, deps: LaunchDeps = defaultLaunchDeps()): void {
  program
    .command('open [workspace]')
    .description('Open a workspace in VS Code or Claude (omit the name/--with to pick)')
    .option('--with <target>', 'code or claude (default: pick interactively)')
    .action(async (workspace: string | undefined, options: { with?: string }) => {
      const target = options.with ? parseLaunchTarget(options.with) : undefined
      const result = await runOpen(ctx, workspace, { with: target }, deps)

      if (result.target === 'code') {
        if (result.opened) {
          console.log(ctx.ui.color.green(`Opened ${result.filePath}`))
        } else {
          console.log(`Couldn't launch the "code" CLI (${result.reason}). Open manually: ${result.filePath}`)
        }
      } else if (!result.opened) {
        console.log(`Couldn't launch Claude (${result.reason}). Run it yourself: cd ${result.dir} && claude`)
      }
    })
}
