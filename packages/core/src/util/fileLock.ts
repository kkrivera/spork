import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import lockfile from 'proper-lockfile'

/**
 * Runs `fn` while holding an exclusive lock on `filePath` — the same
 * mkdir-based primitive `repo/lock.ts`'s `withRepoLock` uses for the repo
 * cache, applied here to a small JSON index file (a workspace manifest, or
 * a repo/workspace registry) instead of a cache directory. Needed because
 * these files get read, mutated in memory, and written back by more than
 * one caller — concurrently, since `@spork/task-runner` wires several
 * `addRepo`/`registerRepoAlias` calls through `Promise.all`. Without a
 * lock around that whole cycle, two concurrent writers can each read the
 * same pre-mutation snapshot and then overwrite one another, silently
 * losing whichever one wrote first.
 *
 * Unlike `withRepoLock`, this doesn't pre-create `filePath` before
 * locking: these files are meaningfully *absent* until their first write
 * (a repo registry that's never been written to, say), and callers'
 * `existsSync` checks rely on that to know to start from an empty
 * default. `realpath: false` lets `proper-lockfile` lock a path that
 * doesn't exist yet, rather than requiring it (its default behavior,
 * which `withRepoLock` satisfies by `mkdir`-ing its target directory
 * first — not an option here, since creating the *file* would corrupt
 * that "absent means empty" signal).
 */
export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(filePath), { recursive: true })

  // A repo scan or a workspace create --repo can fire off dozens of these
  // concurrently against the very same index file, so this needs to
  // tolerate deeper contention than withRepoLock's profile (tuned for a
  // git clone/fetch's much longer, rarer-to-overlap critical section):
  // more retries, shorter backoff, since each critical section here is
  // just an in-memory JSON mutation and a small file write.
  const release = await lockfile.lock(filePath, {
    realpath: false,
    retries: { retries: 20, minTimeout: 25, maxTimeout: 250 },
  })

  try {
    return await fn()
  } finally {
    await release()
  }
}
