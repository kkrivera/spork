import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { cloneBare, fetchAll } from '../git/clone.js'
import { slugify } from '../util/slug.js'

export interface RepoCache {
  /** Stable, filesystem-safe identifier derived from `source`. */
  id: string
  source: string
  /** Path to the shared bare clone backing every worktree for this repo source. */
  path: string
}

/**
 * Derives a stable cache id from a repo source (URL or local path): a readable
 * slug of the repo's name, plus a short hash of the full source so different
 * sources that happen to share a short name don't collide. Note the same
 * underlying repo added via two different URL forms (HTTPS vs SSH) is treated
 * as two distinct sources — see docs/plans/0001-worktree-workspace-architecture.md.
 */
export function repoCacheId(source: string): string {
  const name = source
    .replace(/\.git$/, '')
    .split(/[/:]/)
    .filter(Boolean)
    .pop()
  const hash = createHash('sha1').update(source).digest('hex').slice(0, 8)
  return `${slugify(name ?? 'repo')}-${hash}`
}

export function resolveRepoCache(reposRoot: string, source: string): RepoCache {
  const id = repoCacheId(source)
  return { id, source, path: path.join(reposRoot, id) }
}

/**
 * Ensures a bare clone of `source` exists under `reposRoot`, cloning it on
 * first use and fetching to refresh refs on subsequent calls. Callers that
 * mutate the cache (this included) should hold the lock from `repo/lock.ts`
 * around the whole operation, since the cache is shared across workspaces.
 */
export async function ensureRepoCache(reposRoot: string, source: string): Promise<RepoCache> {
  const cache = resolveRepoCache(reposRoot, source)
  await mkdir(reposRoot, { recursive: true })

  if (existsSync(cache.path)) {
    await fetchAll(cache.path)
  } else {
    await cloneBare(source, cache.path)
  }

  return cache
}
