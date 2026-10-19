import { spawn } from 'node:child_process'

export interface ExecResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
}

export interface CommandExecutor {
  run(command: string, cwd: string): Promise<ExecResult>
}

/** Forwarded to the child verbatim if spork itself receives one while the child is running. */
const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']

/** How long to wait for the child to exit after forwarding a signal before escalating to SIGKILL. */
const FORCE_KILL_GRACE_MS = 2000

/**
 * Runs `command` through a real shell with `stdio: 'inherit'` — the child
 * gets the parent's actual stdin/stdout/stderr directly, not captured or
 * buffered, so an interactive or long-running process (a dev server, a
 * watcher) behaves exactly as if it had been typed straight into this
 * terminal: raw output, working Ctrl+C, no dashboard wrapping it. This is
 * deliberately not routed through `@spork/task-runner`'s live dashboard —
 * that's built for several short tasks that settle and summarize, not one
 * foreground process the user wants direct control over.
 *
 * A real terminal's Ctrl+C already reaches the child for free: `spawn`
 * isn't given `detached: true`, so the child lands in spork's own process
 * group, and a terminal delivers SIGINT to the whole foreground group at
 * once — spork and the child both, same as if the child had been run with
 * no wrapper at all (verified against a real pty). What that doesn't cover
 * is spork's own process being signaled directly rather than through the
 * terminal — a supervisor, a plain `kill <pid>`, a closed terminal sending
 * SIGHUP — so `SIGINT`/`SIGTERM`/`SIGHUP` are also explicitly forwarded to
 * the child here, and the promise doesn't resolve until the child has
 * actually exited, rather than letting Node's default disposition
 * (terminate immediately, orphaning the child) win the race. A child that
 * doesn't exit within a grace period after the forwarded signal — or a
 * second, impatient signal of the same kind arriving before then — escalates
 * straight to `SIGKILL`, mirroring `@spork/task-runner`'s own cancellation
 * grace period, for the same reason: something inside the child could catch
 * and ignore the first signal.
 *
 * One real limit, inherent to signal-based process trees rather than
 * anything spork could paper over: this forwards to the one child process
 * `spawn` returns. For a single simple command, most shells replace
 * themselves with it directly (`exec`, no separate process layer), so that
 * child *is* the real work. For a compound command (`a && b`, pipes), the
 * shell keeps itself around as a wrapper — forwarding still reaches that
 * wrapper, but whether it cascades to something it already forked off
 * depends on that shell's own signal handling, not spork's.
 */
export function createShellExecutor(): CommandExecutor {
  return {
    run(command: string, cwd: string): Promise<ExecResult> {
      return new Promise((resolve, reject) => {
        const child = spawn(command, { cwd, shell: true, stdio: 'inherit' })
        let forwarded = false
        let killTimer: NodeJS.Timeout | undefined

        const forward = (signal: NodeJS.Signals): void => {
          if (forwarded) {
            child.kill('SIGKILL')
            return
          }
          forwarded = true
          child.kill(signal)
          killTimer = setTimeout(() => child.kill('SIGKILL'), FORCE_KILL_GRACE_MS)
        }

        const cleanup = (): void => {
          for (const signal of FORWARDED_SIGNALS) process.off(signal, forward)
          clearTimeout(killTimer)
        }

        for (const signal of FORWARDED_SIGNALS) process.on(signal, forward)

        child.on('error', (error) => {
          cleanup()
          reject(error)
        })
        child.on('exit', (exitCode, signal) => {
          cleanup()
          resolve({ exitCode, signal })
        })
      })
    },
  }
}
