import pc from 'picocolors'
import { clampWidth, equalPaneLines, formatDuration } from './layout.js'
import type { TaskState } from './types.js'

export type Colors = ReturnType<typeof pc.createColors>

function statusIcon(state: TaskState, spinnerFrame: string, colors: Colors): string {
  switch (state.status) {
    case 'success':
      return colors.green('✓')
    case 'failed':
      return colors.red('✗')
    case 'cancelled':
      return colors.yellow('⦸')
    default:
      return colors.cyan(spinnerFrame)
  }
}

function elapsedMs(state: TaskState, now: number): number {
  if (state.startedAt === null) return 0
  return (state.endedAt ?? now) - state.startedAt
}

function headerLine(state: TaskState, now: number, spinnerFrame: string, colors: Colors): string {
  const icon = statusIcon(state, spinnerFrame, colors)
  const duration = colors.dim(formatDuration(elapsedMs(state, now)))
  return `${icon} ${colors.bold(state.task.name)}  ${duration}`
}

/**
 * One frame of the live dashboard: every task gets its own fixed, equal
 * pane — a header line plus up to `equalPaneLines`'s share of its most
 * recent output, dimmed — sized off the terminal's full height and the
 * total task count, not just the ones still running. A settled task's
 * pane keeps showing its last captured output lines (frozen, since
 * `output` stops growing) rather than collapsing and handing its rows to
 * a sibling, so every pane stays the same size for the whole run.
 */
export function renderLiveFrame(
  states: TaskState[],
  columns: number,
  rows: number,
  now: number,
  spinnerFrame: string,
  colors: Colors,
): string[] {
  const perTask = equalPaneLines(rows, states.length)
  const tailCount = Math.max(0, perTask - 1)

  const lines: string[] = []
  for (const state of states) {
    lines.push(clampWidth(headerLine(state, now, spinnerFrame, colors), columns))
    if (tailCount > 0) {
      for (const outputLine of state.output.slice(-tailCount)) {
        lines.push(clampWidth(colors.dim(`  ${outputLine}`), columns))
      }
    }
  }
  return lines
}

/** The permanent, non-truncated record written once every task has settled. */
export function renderFinalLog(states: TaskState[], columns: number, now: number, colors: Colors): string[] {
  const lines: string[] = []
  for (const state of states) {
    lines.push(clampWidth(headerLine(state, now, '', colors), columns))
    for (const outputLine of state.output) {
      lines.push(clampWidth(colors.dim(`  ${outputLine}`), columns))
    }
  }
  return lines
}
