import type { PromptOption } from '@spork/prompts'
import { createShellExecutor, type CommandExecutor } from './commandExecutor.js'
import { createCodeOpener, type Opener } from './opener.js'

export type LaunchTarget = 'code' | 'claude'

export const LAUNCH_TARGET_OPTIONS: PromptOption<LaunchTarget>[] = [
  { label: 'VS Code', value: 'code' },
  { label: 'Claude', value: 'claude' },
]

export interface LaunchOutcome {
  ok: boolean
  reason?: string
}

export interface LaunchDeps {
  opener: Opener
  executor: CommandExecutor
}

export function defaultLaunchDeps(): LaunchDeps {
  return { opener: createCodeOpener(), executor: createShellExecutor() }
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
 */
export async function launchWorkspace(
  target: LaunchTarget,
  dir: string,
  codeWorkspaceFilePath: string,
  deps: LaunchDeps,
): Promise<LaunchOutcome> {
  if (target === 'code') return deps.opener.open(codeWorkspaceFilePath)

  try {
    await deps.executor.run('claude', dir)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
