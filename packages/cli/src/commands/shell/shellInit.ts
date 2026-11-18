import { SHELL_NAMES, shellInitScript, SporkError, type ShellName } from '@spork/core'
import type { Command } from 'commander'

/** The script for `shell`, or a `SporkError` naming the supported ones. */
export function runShellInit(shell: string): string {
  if (!(SHELL_NAMES as readonly string[]).includes(shell)) {
    throw new SporkError(`spork shell-init supports ${SHELL_NAMES.join(', ')}, not "${shell}".`)
  }
  return shellInitScript(shell as ShellName)
}

/**
 * `spork shell-init <shell>`: prints the `spork` shell function that lets
 * the Terminal target `cd` the current shell (docs/plans/0006-terminal-target.md).
 * Meant to be loaded from a startup file, e.g.
 * `eval "$(spork shell-init zsh)"`, which spork offers to add for you.
 */
export function registerShellInitCommand(program: Command): void {
  program
    .command('shell-init <shell>')
    .description("Print the shell function that lets Terminal change your current shell's folder (zsh, bash or fish)")
    .action((shell: string) => {
      process.stdout.write(runShellInit(shell))
    })
}
