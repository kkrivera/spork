import { branchConflictPatterns, branchesConflict } from './branchConflict.js'
import { execGit, GitAuthError, type RemoteOptions } from './exec.js'

/**
 * Returns the remote's URL, or null if it has none (the only realistic
 * failure in a valid repo) — callers fall back to a different identity
 * rather than needing to distinguish failure reasons.
 */
export async function getRemoteUrl(repoPath: string, remoteName = 'origin'): Promise<string | null> {
  try {
    const { stdout } = await execGit(['remote', 'get-url', remoteName], { cwd: repoPath })
    return stdout.trim() || null
  } catch {
    return null
  }
}

export async function setRemoteUrl(repoPath: string, remoteName: string, url: string): Promise<void> {
  await execGit(['remote', 'set-url', remoteName, url], { cwd: repoPath })
}

const SYMREF_LINE = /^ref:\s+refs\/heads\/(\S+)\s+HEAD/

/**
 * Asks `source` (a URL or local path — doesn't need to be cloned yet)
 * directly what its default branch is, via `git ls-remote --symref`. Any
 * failure (unreachable, not a git repo) returns null rather than throwing,
 * the same fail-open convention as `getRemoteUrl`.
 */
export async function getRemoteDefaultBranch(source: string): Promise<string | null> {
  try {
    const { stdout } = await execGit(['ls-remote', '--symref', source, 'HEAD'])
    const match = SYMREF_LINE.exec(stdout)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/** `'auth-failed'`: git couldn't authenticate (see `isAuthFailure`); `'unreachable'`: any other failure. */
export type RemoteAccessStatus = 'ok' | 'auth-failed' | 'unreachable'

export interface RemoteProbe {
  status: RemoteAccessStatus
  /** Whether the remote has a branch named exactly `branch`; false unless `status` is `'ok'`. */
  hasBranch: boolean
  /** Remote branches git won't allow alongside `branch` (see `branchesConflict`); empty unless `status` is `'ok'`. */
  conflicts: string[]
}

/**
 * Asks `source` (a URL or local path — doesn't need to be cloned yet)
 * whether it has a branch named exactly `branch`, and which of its
 * branches would stop `branch` from existing at all, via one `git
 * ls-remote`. That also shows whether spork can reach it with the given
 * `options` (prompts off by default, so this never waits on anyone).
 * Never throws: a failure is reported as a status, for the caller to
 * decide whether it's worth fixing first (an unlocked SSH key) or just
 * left for the real clone/fetch to report.
 */
export async function probeRemote(source: string, branch: string, options: RemoteOptions = {}): Promise<RemoteProbe> {
  const ref = `refs/heads/${branch}`
  try {
    const { stdout } = await execGit(['ls-remote', source, ref, ...branchConflictPatterns(branch)], options)
    const refs = stdout.split('\n').map((line) => line.split('\t')[1]?.trim() ?? '')
    const conflicts = refs
      .filter((name) => name.startsWith('refs/heads/'))
      .map((name) => name.slice('refs/heads/'.length))
      .filter((name) => branchesConflict(branch, name))
    return { status: 'ok', hasBranch: refs.includes(ref), conflicts }
  } catch (error) {
    return { status: error instanceof GitAuthError ? 'auth-failed' : 'unreachable', hasBranch: false, conflicts: [] }
  }
}
