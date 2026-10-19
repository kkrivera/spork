import { spawn } from 'node:child_process'

export interface ExecResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
}

export interface CommandExecutor {
  run(command: string, cwd: string): Promise<ExecResult>
}

/**
 * Runs `command` through a real shell with `stdio: 'inherit'` — the child
 * gets the parent's actual stdin/stdout/stderr directly, not captured or
 * buffered, so an interactive or long-running process (a dev server, a
 * watcher) behaves exactly as if it had been typed straight into this
 * terminal: raw output, working Ctrl+C, no dashboard wrapping it. This is
 * deliberately not routed through `@spork/task-runner`'s live dashboard —
 * that's built for several short tasks that settle and summarize, not one
 * foreground process the user wants direct control over.
 */
export function createShellExecutor(): CommandExecutor {
  return {
    run(command: string, cwd: string): Promise<ExecResult> {
      return new Promise((resolve, reject) => {
        const child = spawn(command, { cwd, shell: true, stdio: 'inherit' })
        child.on('error', reject)
        child.on('exit', (exitCode, signal) => resolve({ exitCode, signal }))
      })
    },
  }
}
