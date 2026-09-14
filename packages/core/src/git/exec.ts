import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ExecResult {
  stdout: string
  stderr: string
}

export interface ExecOptions {
  cwd?: string
}

export class GitCommandError extends Error {
  constructor(
    public readonly args: readonly string[],
    public readonly stderr: string,
    cause?: unknown,
  ) {
    super(`git ${args.join(' ')} failed: ${stderr.trim()}`)
    this.name = 'GitCommandError'
    this.cause = cause
  }
}

/**
 * The single point spork spawns `git` from. Every other module in `core/src/git`
 * calls through here, which is what unit tests mock instead of spawning real
 * `git` processes (see docs/plans/0001-worktree-workspace-architecture.md).
 */
export async function execGit(args: readonly string[], options: ExecOptions = {}): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd: options.cwd })
    return { stdout, stderr }
  } catch (error) {
    throw new GitCommandError(args, extractStderr(error), error)
  }
}

function extractStderr(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'stderr' in error) {
    return String((error as { stderr: unknown }).stderr)
  }
  return ''
}
