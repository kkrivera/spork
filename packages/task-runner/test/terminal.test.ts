import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveDashboard } from '../src/terminal.js'
import type { RenderStream, TaskState } from '../src/types.js'

class FakeStream extends EventEmitter implements RenderStream {
  isTTY: boolean
  columns = 80
  rows = 24
  writes: string[] = []

  constructor(isTTY: boolean) {
    super()
    this.isTTY = isTTY
  }

  write(chunk: string): boolean {
    this.writes.push(chunk)
    return true
  }
}

function state(overrides: Partial<TaskState> = {}): TaskState {
  return {
    task: { name: 'widgets', command: 'echo', args: [] },
    status: 'running',
    output: [],
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null,
    signal: null,
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('LiveDashboard — TTY', () => {
  let stream: FakeStream
  let states: TaskState[]

  beforeEach(() => {
    stream = new FakeStream(true)
    states = [state()]
  })

  it('hides the cursor and starts ticking on start()', () => {
    vi.useFakeTimers()
    const dashboard = new LiveDashboard(stream, states)

    dashboard.start()

    expect(stream.writes[0]).toBe('\x1b[?25l')
    const writesAfterStart = stream.writes.length
    vi.advanceTimersByTime(250)
    expect(stream.writes.length).toBeGreaterThan(writesAfterStart)
  })

  it('redraws immediately on notify(), erasing exactly what the previous frame drew', () => {
    const dashboard = new LiveDashboard(stream, states)
    dashboard.start()
    const afterStart = stream.writes.length

    dashboard.notify()
    const firstFrameLineCount = stream.writes.at(-1)?.split('\n').length // includes trailing empty entry

    dashboard.notify()
    const secondWrite = stream.writes.at(-1) as string

    expect(stream.writes.length).toBe(afterStart + 2)
    expect(secondWrite.startsWith('\x1b[')).toBe(true)
    expect(firstFrameLineCount).toBeGreaterThan(0)
    dashboard.stop()
  })

  it('redraws on a stream resize event', () => {
    const dashboard = new LiveDashboard(stream, states)
    dashboard.start()
    const before = stream.writes.length

    stream.emit('resize')

    expect(stream.writes.length).toBeGreaterThan(before)
    dashboard.stop()
  })
})

describe('LiveDashboard — TTY stop()', () => {
  let stream: FakeStream
  let states: TaskState[]

  beforeEach(() => {
    stream = new FakeStream(true)
    states = [state()]
  })

  it('stop() erases the live view, writes the final log, and shows the cursor again', () => {
    const dashboard = new LiveDashboard(stream, states)
    dashboard.start()
    dashboard.notify()

    dashboard.stop()

    const last = stream.writes.at(-1) as string
    expect(last.endsWith('\x1b[?25h')).toBe(true)
    expect(last).toContain('widgets')
  })

  it('stops responding to resize and ticks after stop()', () => {
    vi.useFakeTimers()
    const dashboard = new LiveDashboard(stream, states)
    dashboard.start()
    dashboard.stop()
    const after = stream.writes.length

    stream.emit('resize')
    vi.advanceTimersByTime(500)

    expect(stream.writes.length).toBe(after)
  })
})

describe('LiveDashboard — non-TTY', () => {
  it('does not hide the cursor or write anything on start()', () => {
    const stream = new FakeStream(false)
    const dashboard = new LiveDashboard(stream, [state()])

    dashboard.start()

    expect(stream.writes).toEqual([])
  })

  it('streams only newly-added output lines, prefixed by task name, on notify()', () => {
    const stream = new FakeStream(false)
    const s = state({ output: ['first'] })
    const dashboard = new LiveDashboard(stream, [s])
    dashboard.start()

    dashboard.notify()
    s.output.push('second')
    dashboard.notify()

    expect(stream.writes).toEqual(['[widgets] first\n', '[widgets] second\n'])
  })

  it('prints a one-line summary once a task settles, exactly once', () => {
    const stream = new FakeStream(false)
    const s = state()
    const dashboard = new LiveDashboard(stream, [s])
    dashboard.start()

    s.status = 'success'
    s.endedAt = (s.startedAt as number) + 500
    dashboard.notify()
    dashboard.notify()

    const summaryWrites = stream.writes.filter((w) => w.includes('success'))
    expect(summaryWrites).toHaveLength(1)
    expect(summaryWrites[0]).toBe('[widgets] success (500ms)\n')
  })

  it('writes nothing extra on stop()', () => {
    const stream = new FakeStream(false)
    const dashboard = new LiveDashboard(stream, [state()])
    dashboard.start()
    dashboard.notify()
    const before = stream.writes.length

    dashboard.stop()

    expect(stream.writes.length).toBe(before)
  })
})
