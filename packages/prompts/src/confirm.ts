import { emitKeypressEvents } from 'node:readline'
import process from 'node:process'
import pc from 'picocolors'
import { runConfirmPrompt } from './terminal.js'
import { NotInteractiveError } from './types.js'
import type { Colors, PromptInputStream, PromptOutputStream } from './types.js'

export interface ConfirmConfig {
  message: string
  /** What Enter (no explicit y/n) answers. Default `true`. */
  defaultValue?: boolean
  /** Defaults to `process.stdin`. */
  input?: PromptInputStream
  /** Defaults to `process.stdout`. */
  output?: PromptOutputStream
  colors?: Colors
}

/**
 * Asks a yes/no question. `y`/`n` answer immediately; Enter accepts
 * `defaultValue`; Esc/Ctrl+C resolve `false` (declining and backing out
 * both mean the same thing here — see `runConfirmPrompt`). Throws
 * `NotInteractiveError` synchronously if either stream isn't a TTY, same
 * as `select` and for the same reason: no one to ask, and no opinion on
 * what the caller should do instead.
 */
export async function confirm(config: ConfirmConfig): Promise<boolean> {
  const input = config.input ?? (process.stdin as unknown as PromptInputStream)
  const output = config.output ?? (process.stdout as unknown as PromptOutputStream)

  if (input.isTTY !== true || output.isTTY !== true) {
    throw new NotInteractiveError()
  }

  const colors = config.colors ?? pc.createColors(output.isTTY === true)

  emitKeypressEvents(input as unknown as NodeJS.ReadStream)
  return runConfirmPrompt(config.message, config.defaultValue ?? true, input, output, colors)
}
