import pc from 'picocolors'
import { formatDuration } from './layout.js'
import { renderFinalLog, renderLiveFrame } from './render.js'
import type { RenderStream, TaskState } from './types.js'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const TICK_MS = 100
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'
const CLEAR_DOWN = '\x1b[0J'

function cursorUp(n: number): string {
  return n > 0 ? `\x1b[${n}A` : ''
}

/**
 * Renders a dashboard of concurrently-running tasks to `stream`: an
 * in-place-redrawn, resize-aware live view on a real TTY, or a plain
 * prefixed line stream (no cursor tricks) everywhere else — e.g. CI, a
 * pipe — mirroring `@spork/cli`'s existing TTY/CI-awareness.
 */
export class LiveDashboard {
  private readonly tty: boolean
  private readonly colors: ReturnType<typeof pc.createColors>
  private lastLineCount = 0
  private spinnerIndex = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly printedCounts = new Map<TaskState, number>()
  private readonly summarized = new Set<TaskState>()
  private readonly onResize = (): void => this.redraw()

  constructor(
    private readonly stream: RenderStream,
    private readonly states: TaskState[],
  ) {
    this.tty = stream.isTTY === true
    this.colors = pc.createColors(this.tty)
  }

  start(): void {
    if (!this.tty) return
    this.stream.write(HIDE_CURSOR)
    this.stream.on('resize', this.onResize)
    this.timer = setInterval(() => this.redraw(), TICK_MS)
  }

  /** Call after every task state change for an immediate update, not just the next tick. */
  notify(): void {
    if (this.tty) this.redraw()
    else this.streamPlainUpdates()
  }

  private redraw(): void {
    this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length
    const columns = this.stream.columns ?? 80
    const rows = this.stream.rows ?? 24
    const frame = renderLiveFrame(
      this.states,
      columns,
      rows,
      Date.now(),
      SPINNER_FRAMES[this.spinnerIndex] as string,
      this.colors,
    )
    const erase = this.lastLineCount > 0 ? cursorUp(this.lastLineCount) + CLEAR_DOWN : ''
    this.stream.write(erase + frame.map((line) => `${line}\n`).join(''))
    this.lastLineCount = frame.length
  }

  private streamPlainUpdates(): void {
    for (const state of this.states) {
      const printed = this.printedCounts.get(state) ?? 0
      for (const line of state.output.slice(printed)) {
        this.stream.write(`[${state.task.name}] ${line}\n`)
      }
      this.printedCounts.set(state, state.output.length)

      if (state.status !== 'pending' && state.status !== 'running' && !this.summarized.has(state)) {
        this.summarized.add(state)
        this.stream.write(`[${state.task.name}] ${state.status} (${summaryDuration(state, Date.now())})\n`)
      }
    }
  }

  /** Stops ticking and, on a TTY, replaces the live view with the permanent final log. */
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.stream.off('resize', this.onResize)
    if (!this.tty) return

    const columns = this.stream.columns ?? 80
    const erase = this.lastLineCount > 0 ? cursorUp(this.lastLineCount) + CLEAR_DOWN : ''
    const finalLines = renderFinalLog(this.states, columns, Date.now(), this.colors)
    this.stream.write(erase + finalLines.map((line) => `${line}\n`).join('') + SHOW_CURSOR)
  }
}

/** Plain-text duration for the non-TTY summary line — that path never colors output. */
function summaryDuration(state: TaskState, now: number): string {
  if (state.startedAt === null) return formatDuration(0)
  return formatDuration((state.endedAt ?? now) - state.startedAt)
}
