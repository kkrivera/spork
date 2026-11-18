import { appendFile, mkdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** The shells spork has an integration for — see docs/plans/0006-terminal-target.md. */
export type ShellName = 'zsh' | 'bash' | 'fish'

export const SHELL_NAMES: readonly ShellName[] = ['zsh', 'bash', 'fish']

/** Which supported shell `shellPath` (usually `$SHELL`) is, or null for any other. */
export function shellFromPath(shellPath: string | undefined): ShellName | null {
  const name = path.basename(shellPath ?? '')
  return (SHELL_NAMES as readonly string[]).includes(name) ? (name as ShellName) : null
}

/** The startup file a new interactive `shell` reads, where the integration line goes. */
export function shellRcPath(shell: ShellName, env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  if (shell === 'zsh') return path.join(env.ZDOTDIR || home, '.zshrc')
  if (shell === 'bash') return path.join(home, '.bashrc')
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'fish', 'config.fish')
}

const POSIX_SCRIPT = `# spork shell integration: lets \`spork workspace open\`/\`create\` change this shell's folder.
spork() {
  local spork_cd_file spork_ret
  spork_cd_file="$(mktemp -t spork-cd.XXXXXX 2>/dev/null)" || { command spork "$@"; return; }
  SPORK_CD_FILE="$spork_cd_file" command spork "$@"
  spork_ret=$?
  if [ -s "$spork_cd_file" ]; then
    cd -- "$(cat -- "$spork_cd_file")" || spork_ret=$?
  fi
  rm -f -- "$spork_cd_file"
  return "$spork_ret"
}
`

const FISH_SCRIPT = `# spork shell integration: lets \`spork workspace open\`/\`create\` change this shell's folder.
function spork --wraps spork --description 'spork, able to change this shell\\'s folder'
    set -l spork_cd_file (mktemp -t spork-cd.XXXXXX 2>/dev/null)
    or begin
        command spork $argv
        return $status
    end
    SPORK_CD_FILE=$spork_cd_file command spork $argv
    set -l spork_ret $status
    if test -s "$spork_cd_file"
        cd (cat $spork_cd_file); or set spork_ret $status
    end
    rm -f $spork_cd_file
    return $spork_ret
end
`

/**
 * The `spork` shell function `spork shell-init <shell>` prints. It runs the
 * real `spork` with `SPORK_CD_FILE` naming a fresh temp file, then `cd`s
 * to whatever folder spork wrote there (only the Terminal target writes
 * one), keeping spork's exit status.
 */
export function shellInitScript(shell: ShellName): string {
  return shell === 'fish' ? FISH_SCRIPT : POSIX_SCRIPT
}

/**
 * The line that loads the integration from a startup file. Guarded so a
 * new shell stays quiet when `spork` isn't installed, or is a version
 * without `shell-init`.
 */
export function shellInitLine(shell: ShellName): string {
  if (shell === 'fish') return 'command -q spork; and spork shell-init fish 2>/dev/null | source'
  return `command -v spork >/dev/null 2>&1 && eval "$(spork shell-init ${shell} 2>/dev/null)"`
}

/** Whether `rcPath` already loads the integration (any `spork shell-init` line counts). */
export async function hasShellIntegration(rcPath: string): Promise<boolean> {
  try {
    return (await readFile(rcPath, 'utf8')).includes('spork shell-init')
  } catch {
    return false
  }
}

/** Appends `shellInitLine` to `rcPath`, creating it (and its folder) if needed. */
export async function installShellIntegration(rcPath: string, shell: ShellName): Promise<void> {
  await mkdir(path.dirname(rcPath), { recursive: true })
  let prefix = '\n'
  try {
    const existing = await readFile(rcPath, 'utf8')
    if (existing.length === 0) prefix = ''
    else if (!existing.endsWith('\n')) prefix = '\n\n'
  } catch {
    prefix = ''
  }
  await appendFile(rcPath, `${prefix}# Lets \`spork workspace open\` change this shell's folder.\n${shellInitLine(shell)}\n`)
}
