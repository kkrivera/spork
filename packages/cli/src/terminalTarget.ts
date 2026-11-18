import { writeFile } from 'node:fs/promises'
import type { CommandExecutor } from './commandExecutor.js'
import type { AppContext } from './context.js'
import { isInteractiveTerminal } from './commands/repo/add.js'
import { tildify } from './output/paths.js'
import { offerShellIntegration } from './shellIntegrationOffer.js'

export interface TerminalDeps {
  /** `SPORK_CD_FILE`, from the shell integration — see `env.ts`. */
  cdFile?: string
  isInteractive(): boolean
  /** Runs right before a new shell starts: the one-time integration offer, then saying how to get back. */
  beforeShell(dir: string): Promise<void>
}

export function defaultTerminalDeps(ctx: AppContext): TerminalDeps {
  return {
    cdFile: ctx.env.cdFile,
    isInteractive: isInteractiveTerminal,
    beforeShell: async (dir) => {
      await offerShellIntegration(ctx)
      console.log(ctx.ui.color.dim(`Opening a new shell in ${tildify(dir)}. Type exit to come back.`))
    },
  }
}

/** Runs the user's own shell; `exec` so the `-c` wrapper shell doesn't stay around underneath it. */
const NEW_SHELL = 'exec "${SHELL:-/bin/sh}"'

/**
 * The Terminal target (docs/plans/0006-terminal-target.md). With the shell
 * integration, writes `dir` to `SPORK_CD_FILE` for the `spork` shell
 * function to `cd` to once spork exits. Without it, starts a new copy of
 * the user's shell in `dir` through the same foreground `CommandExecutor`
 * the Claude target uses, returning when they `exit` it. The shell takes
 * over the terminal's foreground process group, so a Ctrl+C at its prompt
 * never reaches spork's signal forwarding.
 */
export async function openInTerminal(
  dir: string,
  executor: CommandExecutor,
  deps: TerminalDeps,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (deps.cdFile) {
      await writeFile(deps.cdFile, dir)
      return { ok: true }
    }
    if (!deps.isInteractive()) return { ok: false, reason: 'not running in an interactive terminal' }
    await deps.beforeShell(dir)
    await executor.run(NEW_SHELL, dir)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
