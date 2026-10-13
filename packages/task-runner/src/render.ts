import pc from 'picocolors'
import { clampWidth, formatDuration, tailLinesPerRunningTask } from './layout.js'
import type { TaskState } from './types.js'

export type Colors = ReturnType<typeof pc.createColors>

const ACTIVE_STATUSES = new Set(['pending', 'running'])

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
 * One frame of the live dashboard: every task's header line, plus — for
 * tasks still active — up to `tailLinesPerRunningTask`'s share of their
 * most recent output, dimmed. A task that has settled collapses to just
 * its header, handing its rows back to whichever tasks are still running.
 */
export function renderLiveFrame(
  states: TaskState[],
  columns: number,
  rows: number,
  now: number,
  spinnerFrame: string,
  colors: Colors,
): string[] {
  const runningCount = states.filter((s) => ACTIVE_STATUSES.has(s.status)).length
  const doneCount = states.length - runningCount
  const perTask = tailLinesPerRunningTask(rows, runningCount, doneCount)
  const tailCount = Math.max(0, perTask - 1)

  const lines: string[] = []
  for (const state of states) {
    lines.push(clampWidth(headerLine(state, now, spinnerFrame, colors), columns))
    if (ACTIVE_STATUSES.has(state.status) && tailCount > 0) {
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
