import { emitKeypressEvents } from 'node:readline'
import process from 'node:process'
import pc from 'picocolors'
import { createInitialState, resolveSelection } from './state.js'
import { runSelectPrompt } from './terminal.js'
import { NotInteractiveError } from './types.js'
import type { Colors, PromptInputStream, PromptOutputStream, SelectConfig } from './types.js'

function defaultColors(output: PromptOutputStream): Colors {
  return pc.createColors(output.isTTY === true)
}

/**
 * Prompts the user to pick from `config.options` via a fuzzy-searchable,
 * single- or multi-select list. Resolves with the selected values in their
 * original order, or `null` if the user cancelled (Esc/Ctrl+C) — a normal,
 * resolved outcome, not a thrown error (mirrors `@spork/task-runner`'s own
 * "cancelled is a result, not an exception" shape).
 *
 * Throws `NotInteractiveError` synchronously if either stream isn't a TTY,
 * rather than hanging on keypress events that can never arrive — this
 * package has no opinion on what a non-interactive caller should do
 * instead (that's a per-command policy decision, not this package's to
 * make; see `NotInteractiveError`'s doc comment).
 */
export async function select<T>(config: SelectConfig<T>): Promise<T[] | null> {
  const input = config.input ?? (process.stdin as unknown as PromptInputStream)
  const output = config.output ?? (process.stdout as unknown as PromptOutputStream)

  if (input.isTTY !== true || output.isTTY !== true) {
    throw new NotInteractiveError()
  }

  const colors = config.colors ?? defaultColors(output)
  const initialState = createInitialState(config.options, config.mode, config.minSelected ?? 0)

  emitKeypressEvents(input as unknown as NodeJS.ReadStream)
  const finalState = await runSelectPrompt(initialState, config.message, input, output, colors)

  return finalState.done === 'cancelled' ? null : resolveSelection(finalState)
}
