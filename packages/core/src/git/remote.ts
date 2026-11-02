import { execGit } from './exec.js'

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

/**
 * Whether `source` (a URL or local path — doesn't need to be cloned yet)
 * has a branch named exactly `branch`, via `git ls-remote`. Fails open to
 * `false` like `getRemoteDefaultBranch`: an unreachable remote just means
 * there's nothing to offer, not an error worth surfacing.
 */
export async function remoteHasBranch(source: string, branch: string): Promise<boolean> {
  const ref = `refs/heads/${branch}`
  try {
    const { stdout } = await execGit(['ls-remote', source, ref])
    return stdout.split('\n').some((line) => line.split('\t')[1]?.trim() === ref)
  } catch {
    return false
  }
}
