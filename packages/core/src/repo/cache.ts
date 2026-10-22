import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { cloneBare, fetchAll } from '../git/clone.js'
import { slugify } from '../util/slug.js'
import { repoOwner, repoShortName } from '../util/repoName.js'

export interface RepoCache {
  /** Stable, filesystem-safe identifier derived from `source`. */
  id: string
  source: string
  /** Path to the shared bare clone backing every worktree for this repo source. */
  path: string
  /**
   * Path `withRepoLock` should lock for this repo — deliberately NOT `path`
   * itself. `withRepoLock` creates whatever directory it's given before
   * locking it, and if that were `path`, the first `ensureRepoCache` call
   * inside the lock would find an (empty, lock-created) directory already
   * there and wrongly skip cloning.
   */
  lockPath: string
}

/**
 * Derives a stable cache id from a repo source (URL or local path): a
 * readable slug of the repo's owner/org and name (when the source is
 * URL-shaped enough to have an owner — see `repoOwner`), plus a short hash
 * of the full source so different sources that happen to share an owner and
 * name don't collide. The owner prefix is what lets two different orgs'
 * same-named repo (e.g. "acme/widgets" and "other/widgets") read as
 * distinct cache directories rather than only differing by hash. Note the
 * same underlying repo added via two different URL forms (HTTPS vs SSH) is
 * treated as two distinct sources — see
 * docs/plans/0001-worktree-workspace-architecture.md.
 */
export function repoCacheId(source: string): string {
  const owner = repoOwner(source)
  const name = repoShortName(source)
  const readable = owner ? `${owner}-${name}` : name
  const hash = createHash('sha1').update(source).digest('hex').slice(0, 8)
  return `${slugify(readable)}-${hash}`
}

export function resolveRepoCache(reposRoot: string, source: string): RepoCache {
  const id = repoCacheId(source)
  return { id, source, path: path.join(reposRoot, id), lockPath: path.join(reposRoot, '.locks', id) }
}

/** A bare clone always has a HEAD file at its root — a directory existing isn't enough proof it's actually cloned. */
function isCloned(cachePath: string): boolean {
  return existsSync(path.join(cachePath, 'HEAD'))
}

/** Whether `source`'s shared cache has actually been cloned (not just has a path reserved). */
export function repoCacheExists(reposRoot: string, source: string): boolean {
  return isCloned(resolveRepoCache(reposRoot, source).path)
}

export interface EnsureRepoCacheOptions {
  /**
   * Where to actually `git clone --bare` from, if different from `source`.
   * Lets a caller use a fast local path (hardlinked clone) as the clone
   * source while `source` stays the identity the cache is keyed and
   * registered under (e.g. the repo's real upstream URL). Ignored once the
   * cache already exists, since that branch fetches, not clones.
   */
  cloneFrom?: string
  /** Let the clone/fetch prompt on the terminal — see `git/exec.ts`'s `ExecOptions.allowPrompts`. */
  allowPrompts?: boolean
}

/**
 * Ensures a bare clone of `source` exists under `reposRoot`, cloning it on
 * first use and fetching to refresh refs on subsequent calls. Callers that
 * mutate the cache (this included) should hold the lock from `repo/lock.ts`
 * (on the cache's `lockPath`, not `path`) around the whole operation, since
 * the cache is shared across workspaces.
 */
export async function ensureRepoCache(
  reposRoot: string,
  source: string,
  options: EnsureRepoCacheOptions = {},
): Promise<RepoCache> {
  const cache = resolveRepoCache(reposRoot, source)
  await mkdir(reposRoot, { recursive: true })

  if (isCloned(cache.path)) {
    await fetchAll(cache.path, { allowPrompts: options.allowPrompts })
  } else {
    await cloneBare(options.cloneFrom ?? source, cache.path, { allowPrompts: options.allowPrompts })
  }

  return cache
}
