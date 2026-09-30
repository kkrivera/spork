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
