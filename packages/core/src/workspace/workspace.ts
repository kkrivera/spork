import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { addWorktree, pruneWorktrees, removeWorktree } from '../git/worktree.js'
import { getStatus, type WorktreeStatus } from '../git/status.js'
import { hasSubmodules, initSubmodules } from '../git/submodule.js'
import { resolveRepoCache } from '../repo/cache.js'
import { withRepoLock } from '../repo/lock.js'
import { addRepoSource } from '../repo/repos.js'
import { localRepoRegistryPath, resolveScopedRepoAlias } from '../registry/repoRegistry.js'
import { slugify } from '../util/slug.js'
import { repoShortName } from '../util/repoName.js'
import { SporkError } from '../errors.js'
import { writeCodeWorkspace } from './codeWorkspace.js'
import {
  createManifest,
  readManifest,
  writeManifest,
  type WorkspaceManifest,
  type WorktreeEntry,
} from './manifest.js'

export interface WorkspaceContext {
  /** Root directory holding every repo's shared bare-clone cache (typically `~/.spork/repos`). */
  reposRoot: string
  /** Path to the repo alias registry (`~/.spork/repos.json`) — see registry/repoRegistry.ts. */
  repoRegistryPath: string
}

export interface CreateWorkspaceOptions {
  name: string
  dir: string
}

export interface WorkspaceHandle {
  name: string
  dir: string
  manifest: WorkspaceManifest
}

export async function createWorkspace(
  ctx: WorkspaceContext,
  options: CreateWorkspaceOptions,
): Promise<WorkspaceHandle> {
  await mkdir(options.dir, { recursive: true })
  const manifest = createManifest(options.name)
  await writeManifest(options.dir, manifest)
  await writeCodeWorkspace(options.dir, manifest)
  return { name: options.name, dir: options.dir, manifest }
}

export interface ReconcileResult {
  manifest: WorkspaceManifest
  removedFolders: string[]
}

/**
 * Prunes stale git worktree metadata and drops manifest entries whose folder
 * no longer exists on disk (e.g. the user `rm -rf`'d it by hand), rewriting
 * the manifest/.code-workspace if anything changed. Called before every
 * mutating or state-reporting operation below — see
 * docs/plans/0001-worktree-workspace-architecture.md.
 */
export async function reconcileWorkspace(ctx: WorkspaceContext, workspaceDir: string): Promise<ReconcileResult> {
  const manifest = await readManifest(workspaceDir)

  const cachePaths = new Set(manifest.worktrees.map((wt) => resolveRepoCache(ctx.reposRoot, wt.source).path))
  for (const cachePath of cachePaths) {
    if (existsSync(cachePath)) {
      await pruneWorktrees(cachePath)
    }
  }

  const removedFolders: string[] = []
  const survivors = manifest.worktrees.filter((wt) => {
    const stillExists = existsSync(path.join(workspaceDir, wt.folder))
    if (!stillExists) removedFolders.push(wt.folder)
    return stillExists
  })

  if (removedFolders.length > 0) {
    manifest.worktrees = survivors
    await writeManifest(workspaceDir, manifest)
    await writeCodeWorkspace(workspaceDir, manifest)
  }

  return { manifest, removedFolders }
}

export interface AddRepoOptions {
  source: string
  ref?: string
  folder?: string
  /** Register the alias globally instead of locally to this workspace (the default). */
  global?: boolean
}

export interface AddRepoResult {
  entry: WorktreeEntry
  /** Which registry the repo's alias was (re-)registered in. */
  aliasScope: 'local' | 'global'
  /** True if the worktree had a .gitmodules file and its submodules were initialized. */
  submodulesInitialized: boolean
  /** Set if the worktree has submodules but initializing them failed — the worktree itself is still valid and registered. */
  submoduleWarning?: string
}

export async function addRepo(
  ctx: WorkspaceContext,
  workspaceDir: string,
  options: AddRepoOptions,
): Promise<AddRepoResult> {
  const { manifest } = await reconcileWorkspace(ctx, workspaceDir)

  // options.source may be a registered alias (local to this workspace, or global — see
  // registry/repoRegistry.ts) — resolve it to the real source up front so the folder
  // default, cache, and manifest entry all agree.
  const source = await resolveScopedRepoAlias(
    ctx.reposRoot,
    localRepoRegistryPath(workspaceDir),
    ctx.repoRegistryPath,
    options.source,
  )
  const folder = options.folder ?? slugify(repoShortName(source))
  if (manifest.worktrees.some((wt) => wt.folder === folder)) {
    throw new SporkError(
      `"${folder}" is already used in workspace "${manifest.name}". Pass --as to choose a different folder name.`,
    )
  }

  const requestedRef = options.ref ?? 'HEAD'
  const worktreePath = path.join(workspaceDir, folder)
  const localBranch = `spork/${slugify(manifest.name)}/${slugify(folder)}`

  // addRepoSource ensures the cache is cloned/fetched and registers (or reuses) an alias for
  // it — its own short lock. addWorktree gets a separate, second lock: see repo/repos.ts.
  // The alias registers locally to this workspace by default — the target workspace is
  // always known here, unlike the standalone `repo add` command — with --global opting into
  // the shared registry instead.
  const aliasScope: 'local' | 'global' = options.global ? 'global' : 'local'
  const aliasRegistryPath = options.global ? ctx.repoRegistryPath : localRepoRegistryPath(workspaceDir)
  await addRepoSource({ reposRoot: ctx.reposRoot, repoRegistryPath: aliasRegistryPath }, source)

  const cache = resolveRepoCache(ctx.reposRoot, source)
  await withRepoLock(cache.lockPath, () => addWorktree(cache.path, worktreePath, localBranch, requestedRef))

  const entry: WorktreeEntry = {
    folder,
    source,
    requestedRef,
    localBranch,
    addedAt: new Date().toISOString(),
  }

  manifest.worktrees.push(entry)
  await writeManifest(workspaceDir, manifest)
  await writeCodeWorkspace(workspaceDir, manifest)

  // Submodule init is per-worktree, not shared-cache state, so it runs after
  // the lock is released — no reason to hold up other spork operations on
  // this repo's cache while (potentially slow) submodule clones happen. A
  // failure here doesn't undo the worktree/manifest entry above: the repo
  // itself checked out fine, so the add is still considered successful.
  if (!hasSubmodules(worktreePath)) {
    return { entry, aliasScope, submodulesInitialized: false }
  }

  try {
    await initSubmodules(worktreePath)
    return { entry, aliasScope, submodulesInitialized: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { entry, aliasScope, submodulesInitialized: false, submoduleWarning: message }
  }
}

export async function removeRepo(ctx: WorkspaceContext, workspaceDir: string, folder: string): Promise<void> {
  const { manifest } = await reconcileWorkspace(ctx, workspaceDir)

  const entry = manifest.worktrees.find((wt) => wt.folder === folder)
  if (!entry) {
    throw new SporkError(`No worktree named "${folder}" in workspace "${manifest.name}".`)
  }

  const cache = resolveRepoCache(ctx.reposRoot, entry.source)
  const worktreePath = path.join(workspaceDir, folder)

  await withRepoLock(cache.lockPath, async () => {
    await removeWorktree(cache.path, worktreePath, { force: true })
  })

  manifest.worktrees = manifest.worktrees.filter((wt) => wt.folder !== folder)
  await writeManifest(workspaceDir, manifest)
  await writeCodeWorkspace(workspaceDir, manifest)
}

export interface RemoveWorkspaceOptions {
  /** Skip removing worktrees/deleting the workspace directory — only relevant to registry bookkeeping upstream. */
  keepFiles?: boolean
}

export async function removeWorkspace(
  ctx: WorkspaceContext,
  workspaceDir: string,
  options: RemoveWorkspaceOptions = {},
): Promise<void> {
  if (options.keepFiles) return

  const manifest = await readManifest(workspaceDir)
  for (const entry of manifest.worktrees) {
    await removeRepo(ctx, workspaceDir, entry.folder)
  }
  await rm(workspaceDir, { recursive: true, force: true })
}

export interface WorktreeStatusEntry extends WorktreeEntry {
  status: WorktreeStatus
}

export async function getWorkspaceStatus(
  ctx: WorkspaceContext,
  workspaceDir: string,
): Promise<WorktreeStatusEntry[]> {
  const { manifest } = await reconcileWorkspace(ctx, workspaceDir)

  return Promise.all(
    manifest.worktrees.map(async (entry) => ({
      ...entry,
      status: await getStatus(path.join(workspaceDir, entry.folder)),
    })),
  )
}
