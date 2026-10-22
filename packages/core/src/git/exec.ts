import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { authFailureGuidance, isAuthFailure, NO_PROMPT_ENV } from './auth.js'

const execFileAsync = promisify(execFile)

export interface ExecResult {
  stdout: string
  stderr: string
}

export interface ExecOptions {
  cwd?: string
  /**
   * Let git/ssh prompt on the terminal (SSH passphrase, HTTPS password,
   * unknown host key). Off by default, so nothing ever hangs waiting on a
   * prompt nobody can see or answer — see `auth.ts`'s `NO_PROMPT_ENV`. Only
   * pass `true` when a person is at a real terminal *and* nothing else is
   * drawing over it.
   */
  allowPrompts?: boolean
}

/** The subset of `ExecOptions` a higher-level git call forwards to `execGit` unchanged. */
export type PromptOptions = Pick<ExecOptions, 'allowPrompts'>

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

/** A `GitCommandError` that failed on authentication; its message ends with what to do next. */
export class GitAuthError extends GitCommandError {
  constructor(args: readonly string[], stderr: string, allowPrompts: boolean, cause?: unknown) {
    super(args, stderr, cause)
    this.name = 'GitAuthError'
    this.message = `${this.message}\n\n${authFailureGuidance(allowPrompts)}`
  }
}

/**
 * The single point spork spawns `git` from. Every other module in `core/src/git`
 * calls through here, which is what unit tests mock instead of spawning real
 * `git` processes (see docs/plans/0001-worktree-workspace-architecture.md).
 */
export async function execGit(args: readonly string[], options: ExecOptions = {}): Promise<ExecResult> {
  const allowPrompts = options.allowPrompts ?? false
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: options.cwd,
      ...(allowPrompts ? {} : { env: { ...process.env, ...NO_PROMPT_ENV } }),
    })
    return { stdout, stderr }
  } catch (error) {
    const stderr = extractStderr(error)
    throw isAuthFailure(stderr) ? new GitAuthError(args, stderr, allowPrompts, error) : new GitCommandError(args, stderr, error)
  }
}

function extractStderr(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'stderr' in error) {
    return String((error as { stderr: unknown }).stderr)
  }
  return ''
}
