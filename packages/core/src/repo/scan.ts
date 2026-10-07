import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { getRemoteDefaultBranch, getRemoteUrl } from '../git/remote.js'
import { addRepoSource, type RepoContext } from './repos.js'
import type { RepoRegistryEntry } from '../registry/repoRegistry.js'

/**
 * Immediate subdirectories of `scanDir` that look like a git repo (have a
 * `.git` entry — file or dir, covering both plain clones and linked
 * worktrees). One level deep only: this matches "a single flat folder of
 * clones" (`~/code`, `~/src`), not a recursive walk, which would be slower
 * and risks descending into unrelated trees.
 */
export async function findGitRepoDirs(scanDir: string): Promise<string[]> {
  const entries = await readdir(scanDir, { withFileTypes: true })
  const dirs: string[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dirPath = path.join(scanDir, entry.name)
    if (existsSync(path.join(dirPath, '.git'))) {
      dirs.push(dirPath)
    }
  }

  return dirs
}

export interface ScanSkip {
  path: string
  reason: string
}

export interface ScanResult {
  added: RepoRegistryEntry[]
  skipped: ScanSkip[]
}

/**
 * Bulk-adopts every git repo found directly under `scanDir` into spork's
 * managed cache: each one is cloned (fast, hardlinked, since the clone
 * source is local) from its existing checkout rather than the network, and
 * registered exactly as `addRepoSource` would for a typed-in URL. A repo
 * with a real `origin` remote is identified/deduped by that URL (so a repo
 * found by scan and one added later by typing the same URL resolve to the
 * same cache) and has its clone's origin *and HEAD* corrected afterward:
 * origin, since a local clone's origin otherwise defaults to the folder it
 * was cloned from; HEAD, since it otherwise reflects whichever branch
 * happened to be checked out locally rather than the upstream's actual
 * default branch (read directly from the upstream via
 * `getRemoteDefaultBranch`, not trusted from the local checkout). A repo
 * with no remote falls back to its resolved local path as identity, and
 * keeps its local checkout's branch as HEAD since there's no upstream
 * default to correct it against.
 *
 * Skips and continues past a per-repo failure rather than failing the whole
 * scan — a deliberate departure from `create --repo`'s fail-fast precedent,
 * which is a short, explicitly-typed list; this is a bulk operation over
 * *discovered* repos, where one broken entry shouldn't block adopting the
 * rest.
 */
export async function scanAndAddRepos(ctx: RepoContext, scanDir: string): Promise<ScanResult> {
  const dirs = await findGitRepoDirs(scanDir)
  const result: ScanResult = { added: [], skipped: [] }

  for (const dir of dirs) {
    try {
      result.added.push(await addScannedRepo(ctx, dir))
    } catch (error) {
      result.skipped.push({ path: dir, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  return result
}

async function addScannedRepo(ctx: RepoContext, dir: string): Promise<RepoRegistryEntry> {
  const origin = await getRemoteUrl(dir)
  const source = origin ?? path.resolve(dir)
  const defaultBranch = origin ? await getRemoteDefaultBranch(origin) : null
  return addRepoSource(ctx, source, {
    cloneFrom: dir,
    correctOriginTo: origin ?? undefined,
    correctHeadTo: defaultBranch ?? undefined,
  })
}
