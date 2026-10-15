import { toKey } from './keys.js'
import { renderFrame } from './render.js'
import { applyKey } from './state.js'
import type { SelectState } from './state.js'
import type { Colors, NodeKeypress, PromptInputStream, PromptOutputStream } from './types.js'

const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'
const CLEAR_DOWN = '\x1b[0J'
const CLEAR_LINE = '\x1b[2K\r'

function cursorUp(n: number): string {
  return n > 0 ? `\x1b[${n}A` : ''
}

/**
 * Owns drawing/erasing the prompt's one frame at a time — same cursor-hide,
 * erase-exactly-what-was-drawn, redraw approach as `@spork/task-runner`'s
 * `LiveDashboard`, except redrawn on every keypress rather than a timer
 * tick, since nothing here changes between keystrokes on its own.
 */
class PromptRenderer<T> {
  private lastLineCount = 0

  constructor(
    private readonly output: PromptOutputStream,
    private readonly message: string,
    private readonly colors: Colors,
  ) {}

  draw(state: SelectState<T>): void {
    const columns = this.output.columns ?? 80
    const rows = this.output.rows ?? 24
    const frame = renderFrame(state, this.message, columns, rows, this.colors)
    const erase = this.lastLineCount > 0 ? cursorUp(this.lastLineCount) + CLEAR_DOWN : ''
    this.output.write(erase + frame.map((line) => `${line}\n`).join(''))
    this.lastLineCount = frame.length
  }

  clear(): void {
    if (this.lastLineCount > 0) this.output.write(cursorUp(this.lastLineCount) + CLEAR_DOWN)
    this.lastLineCount = 0
  }
}

/**
 * Drives a select prompt to completion against streams that already emit
 * `'keypress'` events — wiring up `node:readline`'s decoder (via
 * `emitKeypressEvents`) is the caller's job (`select.ts`), not this
 * function's, so a test can feed synthetic `'keypress'` events directly
 * without needing a real TTY's escape-sequence parsing.
 *
 * Hides the cursor, redraws on every keypress and output resize, and
 * resolves with the settled state (`done === 'confirmed'` or `'cancelled'`)
 * once the user confirms or cancels. Restores raw mode, resumes/pauses
 * `input` back to how it found it, and shows the cursor again regardless
 * of outcome.
 */
export function runSelectPrompt<T>(
  initialState: SelectState<T>,
  message: string,
  input: PromptInputStream,
  output: PromptOutputStream,
  colors: Colors,
): Promise<SelectState<T>> {
  return new Promise((resolve) => {
    let state = initialState
    const renderer = new PromptRenderer<T>(output, message, colors)

    const onResize = (): void => renderer.draw(state)

    const onKeypress = (str: string | undefined, key: NodeKeypress): void => {
      const translated = toKey(str, key)
      if (!translated) return

      state = applyKey(state, translated)
      if (state.done !== null) {
        finish()
        return
      }
      renderer.draw(state)
    }

    function finish(): void {
      input.off('keypress', onKeypress)
      output.off('resize', onResize)
      input.setRawMode?.(false)
      input.pause?.()
      renderer.clear()
      output.write(SHOW_CURSOR)
      resolve(state)
    }

    input.setRawMode?.(true)
    input.resume?.()
    input.on('keypress', onKeypress)
    output.on('resize', onResize)

    output.write(HIDE_CURSOR)
    renderer.draw(state)
  })
}

/**
 * Drives a yes/no confirm prompt to completion, against a stream that
 * already emits `'keypress'` events (same division of responsibility as
 * `runSelectPrompt` — wiring up the real decoder is `confirm.ts`'s job).
 * `y`/`n` answer immediately; Enter accepts `defaultValue`; Esc/Ctrl+C
 * resolve `false` — a confirm has no separate "cancelled" outcome to
 * preserve, unlike `select`, since declining and backing out both mean
 * the same thing here: the action doesn't happen.
 */
export function runConfirmPrompt(
  message: string,
  defaultValue: boolean,
  input: PromptInputStream,
  output: PromptOutputStream,
  colors: Colors,
): Promise<boolean> {
  return new Promise((resolve) => {
    const hint = defaultValue ? 'Y/n' : 'y/N'
    const prompt = `${colors.bold(message)} ${colors.dim(`(${hint})`)} `

    const onKeypress = (str: string | undefined, key: NodeKeypress): void => {
      if ((key.ctrl && key.name === 'c') || key.name === 'escape') return finish(false)
      if (key.name === 'return' || key.name === 'enter') return finish(defaultValue)
      if (str === 'y' || str === 'Y') return finish(true)
      if (str === 'n' || str === 'N') return finish(false)
    }

    function finish(value: boolean): void {
      input.off('keypress', onKeypress)
      input.setRawMode?.(false)
      input.pause?.()
      output.write(`${CLEAR_LINE}${prompt}${value ? 'Yes' : 'No'}\n${SHOW_CURSOR}`)
      resolve(value)
    }

    input.setRawMode?.(true)
    input.resume?.()
    input.on('keypress', onKeypress)

    output.write(`${HIDE_CURSOR}${prompt}`)
  })
}
