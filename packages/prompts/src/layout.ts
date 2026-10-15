/** Truncates an overlong line with an ellipsis so it can't wrap and desync a redrawn frame. */
export function clampWidth(line: string, columns: number): string {
  if (columns <= 0 || line.length <= columns) return line
  if (columns <= 1) return line.slice(0, columns)
  return `${line.slice(0, columns - 1)}…`
}

export interface Viewport {
  start: number
  end: number
}

/**
 * The slice of `[0, total)` to render, `height` items wide, keeping `cursor`
 * centered when there's room — clamped at both ends rather than scrolling
 * hysteretically, so it's a pure function of the current state alone (no
 * memory of which way the cursor was last moving needed).
 */
export function computeViewport(cursor: number, total: number, height: number): Viewport {
  if (height <= 0 || total <= 0) return { start: 0, end: 0 }
  if (total <= height) return { start: 0, end: total }

  const start = Math.max(0, Math.min(cursor - Math.floor(height / 2), total - height))
  return { start, end: start + height }
}
