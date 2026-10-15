/** "919ms" under a second, "3.727s" at or above — matches ultra-runner's own duration formatting. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(3)}s`
}

/**
 * How many lines (header + tail output) each task's pane gets: the
 * terminal's total rows split evenly across every task, running or
 * settled alike, so each one occupies a fixed, equal portion of the full
 * terminal height for the whole run rather than growing as siblings
 * finish. Floors to 0 (never negative) when there are more tasks than
 * rows to go around.
 */
export function equalPaneLines(terminalRows: number, taskCount: number): number {
  if (taskCount <= 0) return 0
  return Math.max(0, Math.floor(terminalRows / taskCount))
}

/** Truncates an overlong line with an ellipsis so it can't wrap and desync the fixed-height layout. */
export function clampWidth(line: string, columns: number): string {
  if (columns <= 0 || line.length <= columns) return line
  if (columns <= 1) return line.slice(0, columns)
  return `${line.slice(0, columns - 1)}…`
}
