import { mkdir } from 'node:fs/promises'
import lockfile from 'proper-lockfile'

/**
 * Runs `fn` while holding an exclusive lock on `targetPath` (a repo cache
 * directory). The cache is shared across workspaces, so two concurrent spork
 * invocations touching the same repo source (e.g. two scripted `add-repo`
 * calls) would otherwise race on `git fetch`/`worktree add` against the same
 * `.git` dir — see docs/plans/0001-worktree-workspace-architecture.md.
 */
export async function withRepoLock<T>(targetPath: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(targetPath, { recursive: true })

  const release = await lockfile.lock(targetPath, {
    retries: { retries: 5, minTimeout: 100, maxTimeout: 1000 },
  })

  try {
    return await fn()
  } finally {
    await release()
  }
}
