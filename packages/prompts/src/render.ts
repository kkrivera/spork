import { clampWidth, computeViewport, type Viewport } from './layout.js'
import type { FilteredOption, SelectState } from './state.js'
import type { Colors } from './types.js'

/** Lines reserved outside the scrollable option list: one header/search line, one footer line. */
const CHROME_LINES = 2

/** The most options shown at once; a longer list scrolls within this many rows. */
export const MAX_VISIBLE_OPTIONS = 10

/**
 * How many option rows fit: at most `MAX_VISIBLE_OPTIONS`, and always at
 * least one row short of the terminal's height. A frame as tall as the
 * terminal ends with a newline on its last row, which scrolls the screen,
 * and the next redraw's cursor-up then falls one line short of the
 * frame's top — so every keypress would push another line into the
 * scrollback instead of redrawing in place.
 */
export function viewportHeight(rows: number): number {
  return Math.max(1, Math.min(MAX_VISIBLE_OPTIONS, rows - CHROME_LINES - 1))
}

function renderHeaderLine(message: string, query: string, colors: Colors): string {
  return `${colors.bold(message)}  ${colors.dim('search:')} ${query}${colors.dim('▏')}`
}

function renderHighlightedLabel<T>(filtered: FilteredOption<T>, colors: Colors): string {
  if (filtered.matches.length === 0) return filtered.option.label

  const matchedIndices = new Set(filtered.matches)
  return [...filtered.option.label].map((char, i) => (matchedIndices.has(i) ? colors.bold(char) : char)).join('')
}

function renderOptionLine<T>(state: SelectState<T>, filtered: FilteredOption<T>, isCursor: boolean, colors: Colors): string {
  const pointer = isCursor ? colors.cyan('❯') : ' '
  const checkbox = state.mode === 'multi' ? `${state.selected.has(filtered.index) ? '[x]' : '[ ]'} ` : ''
  const label = renderHighlightedLabel(filtered, colors)
  const hint = filtered.option.hint ? colors.dim(`  ${filtered.option.hint}`) : ''
  return `${pointer} ${checkbox}${label}${hint}`
}

const MULTI_HINTS = '↑↓ move · space toggle · ctrl+a all/none · ctrl+u clear search · enter confirm · esc cancel'
const SINGLE_HINTS = '↑↓ move · enter select · ctrl+u clear search · esc cancel'

function renderFooterLine<T>(state: SelectState<T>, viewport: Viewport, colors: Colors): string {
  if (state.validationMessage) return colors.yellow(state.validationMessage)

  const total = state.filtered.length
  const position = viewport.end - viewport.start < total ? `${viewport.start + 1}–${viewport.end} of ${total} · ` : ''
  const count = state.mode === 'multi' ? `${state.selected.size} selected · ` : ''
  const hints = state.mode === 'multi' ? MULTI_HINTS : SINGLE_HINTS
  return colors.dim(`${position}${count}${hints}`)
}

/**
 * One frame of the select prompt: a header/search line, a scrolled window of
 * the filtered options (`viewportHeight` rows at most, keeping the cursor
 * visible — see `computeViewport`), and a footer (which part of a cut-off
 * list is showing, the selection count and key hints, or a validation
 * message in place of all that when Enter was just rejected). `message` is a rendering-only concern, not part of
 * `SelectState` — it never changes once the prompt opens.
 */
export function renderFrame<T>(state: SelectState<T>, message: string, columns: number, rows: number, colors: Colors): string[] {
  const lines = [clampWidth(renderHeaderLine(message, state.query, colors), columns)]

  const viewport = computeViewport(state.cursor, state.filtered.length, viewportHeight(rows))
  const { start, end } = viewport

  if (state.filtered.length === 0) {
    lines.push(clampWidth(colors.dim('No matches.'), columns))
  }
  for (let i = start; i < end; i++) {
    const filtered = state.filtered[i]
    if (filtered) lines.push(clampWidth(renderOptionLine(state, filtered, i === state.cursor, colors), columns))
  }

  lines.push(clampWidth(renderFooterLine(state, viewport, colors), columns))
  return lines
}
