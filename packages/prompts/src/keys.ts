import type { Key, NodeKeypress } from './types.js'

/**
 * Translates a raw `node:readline` keypress into the small, terminal-
 * independent `Key` vocabulary `applyKey` consumes — `null` for anything
 * unrecognized (e.g. a function key), which the caller just ignores.
 *
 * Ctrl+C and Escape both cancel. Ctrl+A is repurposed as "select/deselect
 * all" (not readline's usual "move to line start" — there's no cursor
 * position within the query to move to here) and Ctrl+U as "clear the
 * whole query" (readline's own "clear to line start" collapses to the same
 * thing when the cursor is always at the end). Space is checked by the
 * literal character rather than `key.name`, since that's reported
 * inconsistently across platforms/terminals — this way it's always
 * recognized as "toggle", never inserted into the search query.
 */
export function toKey(str: string | undefined, key: NodeKeypress): Key | null {
  if ((key.ctrl && key.name === 'c') || key.name === 'escape') return { type: 'escape' }
  if (key.name === 'return' || key.name === 'enter') return { type: 'enter' }
  if (key.name === 'up') return { type: 'up' }
  if (key.name === 'down') return { type: 'down' }
  if (key.name === 'backspace') return { type: 'backspace' }
  if (key.ctrl && key.name === 'a') return { type: 'selectAll' }
  if (key.ctrl && key.name === 'u') return { type: 'clearQuery' }
  if (str === ' ') return { type: 'space' }
  if (str && str.length === 1 && !key.ctrl && !key.meta) return { type: 'char', char: str }
  return null
}
