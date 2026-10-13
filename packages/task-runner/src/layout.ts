/** "919ms" under a second, "3.727s" at or above — matches ultra-runner's own duration formatting. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(3)}s`
}

/**
 * How many lines (header + tail output) each still-running task gets, out of
 * the terminal's total rows, after reserving one line per already-finished
 * task for its one-line summary. Finishing a task immediately hands its
 * share back to the tasks still running. Floors to 0 (never negative) when
 * there are more running tasks than rows to go around.
 */
export function tailLinesPerRunningTask(terminalRows: number, runningCount: number, doneCount: number): number {
  if (runningCount <= 0) return 0
  const remaining = Math.max(0, terminalRows - doneCount)
  return Math.max(0, Math.floor(remaining / runningCount))
}

/** Truncates an overlong line with an ellipsis so it can't wrap and desync the fixed-height layout. */
export function clampWidth(line: string, columns: number): string {
  if (columns <= 0 || line.length <= columns) return line
  if (columns <= 1) return line.slice(0, columns)
  return `${line.slice(0, columns - 1)}…`
}
