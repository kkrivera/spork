import {
  hasShellIntegration,
  installShellIntegration,
  PREFERENCES_PATH,
  readPreferences,
  shellFromPath,
  shellInitLine,
  shellRcPath,
  updatePreferences,
} from '@spork/core'
import { confirm, NotInteractiveError } from '@spork/prompts'
import type { AppContext } from './context.js'
import { tildify } from './output/paths.js'

export interface ShellIntegrationOfferDeps {
  env: NodeJS.ProcessEnv
  preferencesPath: string
}

/**
 * Asks, once ever, whether to add the shell integration's line to the
 * user's shell startup file, right before Terminal falls back to starting
 * a new shell (see docs/plans/0006-terminal-target.md). Skipped when
 * `$SHELL` isn't zsh, bash or fish, when the line is already there (the
 * current shell just hasn't reloaded it), when it was asked before, and
 * when there's no terminal to ask on. Whatever the answer, it's recorded
 * so it's never asked again.
 */
export async function offerShellIntegration(
  ctx: AppContext,
  deps: ShellIntegrationOfferDeps = { env: process.env, preferencesPath: PREFERENCES_PATH },
): Promise<void> {
  const shell = shellFromPath(deps.env.SHELL)
  if (!shell) return
  const rcPath = shellRcPath(shell, deps.env)
  if (await hasShellIntegration(rcPath)) return
  if ((await readPreferences(deps.preferencesPath)).shellIntegrationOffered) return

  let accepted: boolean
  try {
    accepted = await confirm({
      message: `Add one line to ${tildify(rcPath)} so Terminal moves this shell to the workspace, instead of starting a new shell?`,
    })
  } catch (error) {
    if (error instanceof NotInteractiveError) return
    throw error
  }

  await updatePreferences(deps.preferencesPath, { shellIntegrationOffered: true })
  if (!accepted) {
    console.log(ctx.ui.color.dim(`spork won't ask again. To set it up later, add this line to ${tildify(rcPath)}:`))
    console.log(ctx.ui.color.dim(`  ${shellInitLine(shell)}`))
    return
  }
  await installShellIntegration(rcPath, shell)
  console.log(ctx.ui.color.green(`Added to ${tildify(rcPath)}. Every new shell, including the one opening now, gets it.`))
}
