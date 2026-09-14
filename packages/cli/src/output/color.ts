import process from 'node:process'
import pc from 'picocolors'

export type Colors = ReturnType<typeof pc.createColors>

export interface Ui {
  color: Colors
  isColorEnabled: boolean
}

export interface UiOptions {
  argv?: readonly string[]
  env?: NodeJS.ProcessEnv
  isTTY?: boolean
}

/**
 * Color precedence: an explicit `--no-color`/`--color` flag wins outright,
 * then the NO_COLOR convention (https://no-color.org — presence disables,
 * regardless of value), then CI (no human is watching a terminal), then
 * whether stdout is actually a TTY. Every spork command must stay readable
 * with color off, since this also has to behave well piped or in CI.
 */
export function resolveColorEnabled(options: UiOptions = {}): boolean {
  const argv = options.argv ?? process.argv
  const env = options.env ?? process.env
  const isTTY = options.isTTY ?? Boolean(process.stdout.isTTY)

  if (argv.includes('--no-color')) return false
  if (argv.includes('--color')) return true
  if (env.NO_COLOR !== undefined) return false
  if (env.CI !== undefined) return false
  return isTTY
}

export function createUi(options: UiOptions = {}): Ui {
  const isColorEnabled = resolveColorEnabled(options)
  return { color: pc.createColors(isColorEnabled), isColorEnabled }
}
