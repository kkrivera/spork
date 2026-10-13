import { spawn } from 'node:child_process'
import type { TaskState } from './types.js'

/** Splits arbitrary stdout/stderr chunks into complete lines, buffering a trailing partial line across calls. */
class LineBuffer {
  private partial = ''

  push(chunk: string): string[] {
    const combined = this.partial + chunk
    const lines = combined.split('\n')
    this.partial = lines.pop() ?? ''
    return lines
  }

  flush(): string[] {
    if (!this.partial) return []
    const rest = this.partial
    this.partial = ''
    return [rest]
  }
}

/**
 * How long to wait, after an abort, for the process to exit on its own from
 * the SIGTERM `spawn`'s own `signal` plumbing already sent, before
 * escalating to SIGKILL — and again, how long to wait for *that* before
 * giving up and settling anyway. A process that traps/ignores SIGTERM (a
 * real, not hypothetical, case — confirmed by a manual test against a bash
 * script with its own TERM trap) must not be able to keep `runTasks`
 * hanging, or outlive the whole program as an orphan.
 */
const KILL_GRACE_MS = 2000

/**
 * Spawns `state.task` and mutates `state` in place on every
 * start/output/settle transition, invoking `onChange` after each one — the
 * caller passes in the same object it hands to the renderer, so the
 * dashboard observes updates without needing immutable snapshots or a
 * separate state-merging step. Resolves once the process has *actually*
 * exited (successfully, with a non-zero code, or killed via `signal` firing
 * — see the `cancelled` check below) — never on the abort alone, since
 * Node's own `signal` plumbing only sends one SIGTERM and does not confirm
 * or escalate.
 */
export function spawnTask(state: TaskState, signal: AbortSignal, onChange: (state: TaskState) => void): Promise<TaskState> {
  const { task } = state

  return new Promise((resolve) => {
    const stdoutBuf = new LineBuffer()
    const stderrBuf = new LineBuffer()
    let killTimer: ReturnType<typeof setTimeout> | null = null
    let forceSettleTimer: ReturnType<typeof setTimeout> | null = null

    const appendLines = (lines: string[]): void => {
      if (lines.length === 0) return
      state.output.push(...lines)
      onChange(state)
    }

    const child = spawn(task.command, task.args ?? [], { cwd: task.cwd, env: task.env, signal })

    state.status = 'running'
    state.startedAt = Date.now()
    onChange(state)

    child.stdout?.on('data', (chunk: Buffer) => appendLines(stdoutBuf.push(chunk.toString())))
    child.stderr?.on('data', (chunk: Buffer) => appendLines(stderrBuf.push(chunk.toString())))

    let settled = false
    const settle = (exitCode: number | null, exitSignal: NodeJS.Signals | null): void => {
      if (settled) return
      settled = true
      if (killTimer) clearTimeout(killTimer)
      if (forceSettleTimer) clearTimeout(forceSettleTimer)
      appendLines(stdoutBuf.flush())
      appendLines(stderrBuf.flush())
      state.endedAt = Date.now()
      state.exitCode = exitCode
      state.signal = exitSignal
      state.status = signal.aborted ? 'cancelled' : exitCode === 0 ? 'success' : 'failed'
      onChange(state)
      resolve(state)
    }

    signal.addEventListener('abort', () => {
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // already gone
        }
      }, KILL_GRACE_MS)
      forceSettleTimer = setTimeout(() => settle(null, 'SIGKILL'), KILL_GRACE_MS * 2)
    })

    child.on('error', (error) => {
      // An abort fires Node's own AbortError here as well as (usually) on 'close' —
      // don't settle on it; the timers above or the real 'close' below will.
      if (signal.aborted) return
      appendLines([error.message])
      settle(null, null)
    })
    child.on('close', (exitCode, exitSignal) => settle(exitCode, exitSignal))
  })
}
