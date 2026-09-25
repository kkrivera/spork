import { rm } from 'node:fs/promises'
import { ensureRepoCache, repoCacheId, resolveRepoCache } from './cache.js'
import { withRepoLock } from './lock.js'
import {
  listRepoAliases,
  registerRepoAlias,
  resolveRepoAlias,
  unregisterRepoAlias,
  type RepoRegistryEntry,
} from '../registry/repoRegistry.js'
import { listWorkspaces } from '../registry/registry.js'
import { readManifest } from '../workspace/manifest.js'
import { slugify } from '../util/slug.js'
import { repoShortName } from '../util/repoName.js'
import { SporkError } from '../errors.js'

export interface RepoContext {
  reposRoot: string
  repoRegistryPath: string
}

export function defaultAlias(source: string): string {
  return slugify(repoShortName(source))
}

export interface AddRepoSourceOptions {
  alias?: string
}

/**
 * Ensures `source` (a real repo source — see `addRepoSourceOrAlias` if the
 * input might be an alias instead) is cloned/cached, then registers or
 * reuses an alias for it.
 */
export async function addRepoSource(
  ctx: RepoContext,
  source: string,
  options: AddRepoSourceOptions = {},
): Promise<RepoRegistryEntry> {
  const cache = resolveRepoCache(ctx.reposRoot, source)
  await withRepoLock(cache.lockPath, () => ensureRepoCache(ctx.reposRoot, source))

  const existing = await listRepoAliases(ctx.repoRegistryPath, ctx.reposRoot)
  const existingForSource = existing.find((repo) => repo.source === source)
  if (existingForSource && (!options.alias || options.alias === existingForSource.alias)) {
    return existingForSource
  }

  const alias = resolveAliasToRegister(source, existing, options.alias)
  const entry: RepoRegistryEntry = { alias, source, addedAt: new Date().toISOString() }
  await registerRepoAlias(ctx.repoRegistryPath, entry)
  return entry
}

/**
 * `addRepoSource`, but accepting either a real source or an already-known
 * alias for one (mirroring `resolveWorkspaceDir`'s name-or-raw-fallback
 * pattern) — the one place "what does this input string refer to" gets
 * resolved, used by both the top-level `repo add` command and
 * `workspace.ts`'s `addRepo`, so `spork repo add widgets` (an existing
 * alias) and `spork workspace add-repo demo widgets` behave identically.
 */
export async function addRepoSourceOrAlias(
  ctx: RepoContext,
  aliasOrSource: string,
  options: AddRepoSourceOptions = {},
): Promise<RepoRegistryEntry> {
  const source = await resolveRepoAlias(ctx.repoRegistryPath, ctx.reposRoot, aliasOrSource)
  return addRepoSource(ctx, source, options)
}

/**
 * An explicit `--as <alias>` must be unclaimed for THIS source or it's a
 * loud error (the user asked for that exact name). An automatic alias never
 * fails: it tries the short, readable default and falls back to the
 * fully-qualified (and therefore always-unique) cache id on collision.
 */
function resolveAliasToRegister(source: string, existing: RepoRegistryEntry[], requestedAlias?: string): string {
  if (requestedAlias) {
    const taken = existing.find((repo) => repo.alias === requestedAlias)
    if (taken) {
      throw new SporkError(`Repo alias "${requestedAlias}" is already used for a different source (${taken.source}).`)
    }
    return requestedAlias
  }

  const short = defaultAlias(source)
  return existing.some((repo) => repo.alias === short) ? repoCacheId(source) : short
}

export interface RepoUsage {
  workspaceName: string
  folder: string
}

export interface RemoveRepoSourceContext extends RepoContext {
  /** The *workspace* registry path — needed to check no workspace still references this source before removing it. */
  workspaceRegistryPath: string
}

/** Which workspaces (and which folder within each) currently have a worktree checked out from `source`. */
export async function findRepoUsages(ctx: RemoveRepoSourceContext, source: string): Promise<RepoUsage[]> {
  const workspaces = await listWorkspaces(ctx.workspaceRegistryPath)
  const usages: RepoUsage[] = []

  for (const workspace of workspaces) {
    const manifest = await readManifest(workspace.dir)
    for (const worktree of manifest.worktrees) {
      if (worktree.source === source) {
        usages.push({ workspaceName: workspace.name, folder: worktree.folder })
      }
    }
  }

  return usages
}

/**
 * Removes a repo's cache and forgets its alias — but only if no workspace
 * still has a worktree checked out from it. A worktree is a live pointer
 * into its bare repo's object store, so deleting the cache out from under
 * one would corrupt it; there's deliberately no force-override for that.
 */
export async function removeRepoSource(ctx: RemoveRepoSourceContext, alias: string): Promise<void> {
  const existing = await listRepoAliases(ctx.repoRegistryPath, ctx.reposRoot)
  const entry = existing.find((repo) => repo.alias === alias)
  if (!entry) {
    throw new SporkError(`No repo alias named "${alias}" is registered.`)
  }

  const usages = await findRepoUsages(ctx, entry.source)
  if (usages.length > 0) {
    const usedBy = usages.map((usage) => `"${usage.workspaceName}" (${usage.folder})`).join(', ')
    throw new SporkError(`"${alias}" is still used by ${usedBy}. Remove it from those workspaces first.`)
  }

  const cache = resolveRepoCache(ctx.reposRoot, entry.source)
  await withRepoLock(cache.lockPath, () => rm(cache.path, { recursive: true, force: true }))
  await unregisterRepoAlias(ctx.repoRegistryPath, alias)
}
