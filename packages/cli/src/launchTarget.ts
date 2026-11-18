import type { PromptOption } from '@spork/prompts'
import { createShellExecutor, type CommandExecutor } from './commandExecutor.js'
import type { AppContext } from './context.js'
import { createCodeOpener, type Opener } from './opener.js'
import { tildify } from './output/paths.js'
import { defaultTerminalDeps, openInTerminal, type TerminalDeps } from './terminalTarget.js'

export type LaunchTarget = 'code' | 'claude' | 'terminal'

export const LAUNCH_TARGETS: readonly LaunchTarget[] = ['code', 'claude', 'terminal']

export const LAUNCH_TARGET_OPTIONS: PromptOption<LaunchTarget>[] = [
  { label: 'VS Code', value: 'code' },
  { label: 'Claude', value: 'claude' },
  { label: 'Terminal', value: 'terminal', hint: 'go to its folder' },
]

export interface LaunchOutcome {
  ok: boolean
  reason?: string
}

export interface LaunchDeps {
  opener: Opener
  executor: CommandExecutor
  terminal: TerminalDeps
}

export function defaultLaunchDeps(ctx: AppContext): LaunchDeps {
  return { opener: createCodeOpener(), executor: createShellExecutor(), terminal: defaultTerminalDeps(ctx) }
}

/**
 * Launches a workspace in `target`: VS Code via the injectable `Opener`
 * (launched as a separate GUI process, same as always), or Claude via the
 * injectable `CommandExecutor` — `claude` inherits the terminal and runs
 * cwd'd into the workspace directory, the same foreground/inherited-stdio
 * mechanism `workspace exec` already uses, since Claude is itself an
 * interactive terminal app rather than something launchable in the
 * background. A Claude session's own exit code/signal is deliberately
 * *not* treated as launch success/failure — the user was present
 * throughout it, so there's nothing more to report once it returns.
 * Only a genuine failure to even spawn it (e.g. no shell available) is.
 * Terminal goes to the folder — see `terminalTarget.ts`.
 */
export async function launchWorkspace(
  target: LaunchTarget,
  dir: string,
  codeWorkspaceFilePath: string,
  deps: LaunchDeps,
): Promise<LaunchOutcome> {
  if (target === 'code') return deps.opener.open(codeWorkspaceFilePath)
  if (target === 'terminal') return openInTerminal(dir, deps.executor, deps.terminal)

  try {
    await deps.executor.run('claude', dir)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/** What to say when Claude or Terminal couldn't start, with how to get there by hand. */
export function launchFailureMessage(target: 'claude' | 'terminal', dir: string, reason?: string): string {
  if (target === 'claude') return `Couldn't launch Claude (${reason}). Run it yourself: cd ${tildify(dir)} && claude`
  return `Couldn't open a shell (${reason}). Go there with: cd ${tildify(dir)}`
}
