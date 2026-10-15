import type pc from 'picocolors'

export type Colors = ReturnType<typeof pc.createColors>

/** One selectable item. `hint` renders dimmed after `label` (e.g. a repo's source/scope). */
export interface PromptOption<T> {
  label: string
  value: T
  hint?: string
  /** Pre-selected when the prompt opens. */
  selected?: boolean
}

/** The subset of `NodeJS.ReadStream` a prompt needs — narrow enough to fake in tests. */
export interface PromptInputStream {
  isTTY?: boolean
  setRawMode?(mode: boolean): void
  on(event: 'keypress', listener: (str: string | undefined, key: NodeKeypress) => void): unknown
  off(event: 'keypress', listener: (str: string | undefined, key: NodeKeypress) => void): unknown
  ref?(): unknown
  unref?(): unknown
  resume?(): unknown
  pause?(): unknown
}

/** The subset of `NodeJS.WriteStream` a prompt needs — narrow enough to fake in tests. */
export interface PromptOutputStream {
  write(chunk: string): boolean
  isTTY?: boolean
  columns?: number
  rows?: number
  on(event: 'resize', listener: () => void): unknown
  off(event: 'resize', listener: () => void): unknown
}

/** The shape `node:readline`'s `emitKeypressEvents` reports on a `'keypress'` event. */
export interface NodeKeypress {
  name?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  sequence?: string
}

/** The small, terminal-independent vocabulary `applyKey` consumes. */
export type Key =
  | { type: 'up' | 'down' | 'space' | 'enter' | 'escape' | 'selectAll' | 'clearQuery' | 'backspace' }
  | { type: 'char'; char: string }

export interface SelectConfig<T> {
  message: string
  options: PromptOption<T>[]
  mode: 'single' | 'multi'
  /** Minimum selections required before Enter confirms (multi-select only). Default 0. */
  minSelected?: number
  /** Defaults to `process.stdin`. */
  input?: PromptInputStream
  /** Defaults to `process.stdout`. */
  output?: PromptOutputStream
  colors?: Colors
}

/** Thrown synchronously by `select` when either stream isn't a TTY — there's no one it can prompt. */
export class NotInteractiveError extends Error {
  constructor(message = 'Cannot prompt interactively: not a TTY.') {
    super(message)
    this.name = 'NotInteractiveError'
  }
}
