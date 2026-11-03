import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type SshTool = 'ssh' | 'ssh-add' | 'ssh-keygen'

/**
 * The single point spork spawns OpenSSH's own tools from, the way
 * `git/exec.ts`'s `execGit` is for git — every other module in `src/ssh`
 * calls through here, which is what unit tests mock. `sshAuthSock` picks
 * the agent `ssh-add` talks to; unset keeps the user's own. Throws on a
 * non-zero exit, like `execFile`.
 */
export async function execSsh(tool: SshTool, args: readonly string[], sshAuthSock?: string): Promise<string> {
  const { stdout } = await execFileAsync(tool, args, sshAuthSock ? { env: envWithAgent(sshAuthSock) } : {})
  return stdout
}

/**
 * Runs `ssh-add` attached to the user's terminal, so it asks for the key's
 * passphrase itself — spork never sees it. `SSH_ASKPASS_REQUIRE=never`
 * keeps it on the terminal even if the user's environment names a GUI
 * askpass. Resolves whether it exited 0 (the key was added).
 */
export function runSshAddOnTerminal(args: readonly string[], sshAuthSock: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('ssh-add', args, {
      stdio: 'inherit',
      env: { ...envWithAgent(sshAuthSock), SSH_ASKPASS_REQUIRE: 'never' },
    })
    child.once('error', () => resolve(false))
    child.once('exit', (code) => resolve(code === 0))
  })
}

/** Starts `ssh-agent` with `args` as a child of spork's own process, its output discarded. */
export function spawnSshAgent(args: readonly string[]): ChildProcess {
  return spawn('ssh-agent', args, { stdio: 'ignore' })
}

function envWithAgent(sshAuthSock: string): NodeJS.ProcessEnv {
  return { ...process.env, SSH_AUTH_SOCK: sshAuthSock }
}
