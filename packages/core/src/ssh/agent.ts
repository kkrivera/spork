import { existsSync, rmSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runSshAddOnTerminal, spawnSshAgent } from './exec.js'

/**
 * How long a key stays in the temporary agent even if spork never gets to
 * stop it (killed outright with `kill -9`). Long enough for a slow clone;
 * normally the agent is stopped well before this.
 */
const KEY_LIFETIME_SECONDS = 3600
const STARTUP_TIMEOUT_MS = 2000
const STARTUP_POLL_MS = 20

/** An ssh-agent spork started for one command, holding only the keys unlocked for it. */
export interface TemporaryAgent {
  /** Its socket — pass as `SSH_AUTH_SOCK` (`ExecOptions.sshAuthSock`) to use it. */
  readonly socket: string
  /**
   * Has `ssh-add` ask for `keyPath`'s passphrase on the terminal and load
   * the key into this agent. Resolves false if it wasn't added (Enter
   * with no passphrase skips it).
   */
  unlock(keyPath: string): Promise<boolean>
  /** Stops the agent and removes its directory. Safe to call more than once. */
  stop(): Promise<void>
}

/**
 * Starts a private `ssh-agent` for the length of one command. Its socket
 * is in a fresh temp directory only the user can open (`mkdtemp` creates
 * it 0700), so it never touches the user's own agent or any file of
 * theirs. `-D` keeps it attached to spork's process: Ctrl+C reaches it too,
 * and it removes its own socket when it exits. `-t` makes every key it
 * holds expire on its own, in case it's ever left running. Also stopped
 * on process exit, as a backstop for a path that never calls `stop`.
 */
export async function startTemporaryAgent(): Promise<TemporaryAgent> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spork-agent-'))
  const socket = path.join(dir, 'agent.sock')
  const child = spawnSshAgent(['-D', '-a', socket, '-t', String(KEY_LIFETIME_SECONDS)])
  const stopSync = (): void => {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
  process.once('exit', stopSync)

  try {
    await waitForSocket(socket, child)
  } catch (error) {
    process.removeListener('exit', stopSync)
    stopSync()
    throw error
  }

  return {
    socket,
    unlock: (keyPath) => runSshAddOnTerminal(['-q', keyPath], socket),
    stop: async () => {
      process.removeListener('exit', stopSync)
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve))
        child.kill()
        await exited
      }
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/** Resolves once the agent's socket exists; rejects if it exits, fails to spawn, or takes too long. */
function waitForSocket(socket: string, child: ReturnType<typeof spawnSshAgent>): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const fail = (reason: string): void => {
      clearInterval(timer)
      reject(new Error(`Couldn't start a temporary ssh-agent: ${reason}`))
    }
    const timer = setInterval(() => {
      if (existsSync(socket)) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - started > STARTUP_TIMEOUT_MS) {
        fail('it never opened its socket')
      }
    }, STARTUP_POLL_MS)
    child.once('error', (error) => fail(error.message))
    child.once('exit', (code) => fail(`it exited with code ${String(code)}`))
  })
}
