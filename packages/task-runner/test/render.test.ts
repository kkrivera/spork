import pc from 'picocolors'
import { describe, expect, it } from 'vitest'
import { renderFinalLog, renderLiveFrame } from '../src/render.js'
import type { TaskState } from '../src/types.js'

const colors = pc.createColors(false)

function state(overrides: Partial<TaskState> = {}): TaskState {
  return {
    task: { name: 'widgets', command: 'echo', args: [] },
    status: 'running',
    output: [],
    startedAt: 1000,
    endedAt: null,
    exitCode: null,
    signal: null,
    ...overrides,
  }
}

describe('renderLiveFrame', () => {
  it('shows a spinner, name, and duration for a running task', () => {
    const lines = renderLiveFrame([state()], 80, 24, 1919, '⠋', colors)

    expect(lines[0]).toBe('⠋ widgets  919ms')
  })

  it('shows the last N tail lines for a running task, sharing the available rows', () => {
    const s = state({ output: ['one', 'two', 'three', 'four', 'five'] })
    // 1 running task, 3 total rows available -> 1 header + 2 tail lines (the last 2)
    const lines = renderLiveFrame([s], 80, 3, 1000, '⠋', colors)

    expect(lines).toEqual(['⠋ widgets  0ms', '  four', '  five'])
  })

  it('gives every task an equal, fixed-height pane regardless of status', () => {
    const done = state({ status: 'success', startedAt: 1000, endedAt: 1500, output: ['done output'] })
    const running = state({ task: { name: 'gadgets', command: 'echo', args: [] }, output: ['line1', 'line2'] })

    // 2 tasks, 5 rows -> 2 rows each (1 header + 1 tail line), not reallocated toward the still-running one
    const lines = renderLiveFrame([done, running], 80, 5, 2000, '⠋', colors)

    expect(lines).toEqual(['✓ widgets  500ms', '  done output', '⠋ gadgets  1.000s', '  line2'])
  })

  it("keeps a settled task's pane the same size as a still-running one's", () => {
    const done = state({ status: 'success', startedAt: 1000, endedAt: 1500, output: ['done output'] })
    const running = state({ task: { name: 'gadgets', command: 'echo', args: [] }, output: ['line1', 'line2'] })

    const lines = renderLiveFrame([done, running], 80, 5, 2000, '⠋', colors)
    const donePane = lines.slice(0, 2)
    const runningPane = lines.slice(2, 4)

    expect(donePane).toHaveLength(runningPane.length)
  })

  it('shows a failed or cancelled icon', () => {
    const failed = state({ status: 'failed', exitCode: 1 })
    const cancelled = state({ status: 'cancelled' })

    expect(renderLiveFrame([failed], 80, 24, 1000, '⠋', colors)[0]).toContain('✗')
    expect(renderLiveFrame([cancelled], 80, 24, 1000, '⠋', colors)[0]).toContain('⦸')
  })

  it('truncates a header or tail line to the terminal width', () => {
    const long = state({ task: { name: 'x'.repeat(200), command: 'echo', args: [] } })
    const lines = renderLiveFrame([long], 40, 24, 1000, '⠋', colors)

    expect(lines[0]?.length).toBeLessThanOrEqual(40)
  })
})

describe('renderFinalLog', () => {
  it('shows every captured output line in full, not just a tail, for a settled task', () => {
    const s = state({
      status: 'success',
      startedAt: 1000,
      endedAt: 1200,
      output: ['line1', 'line2', 'line3', 'line4', 'line5'],
    })

    const lines = renderFinalLog([s], 80, 2000, colors)

    expect(lines).toEqual(['✓ widgets  200ms', '  line1', '  line2', '  line3', '  line4', '  line5'])
  })

  it('shows just the header for a settled task with no output', () => {
    const s = state({ status: 'success', startedAt: 1000, endedAt: 1200, output: [] })

    expect(renderFinalLog([s], 80, 2000, colors)).toEqual(['✓ widgets  200ms'])
  })
})
