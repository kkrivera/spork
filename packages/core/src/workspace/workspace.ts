import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { addWorktree, pruneWorktrees, removeWorktree } from '../git/worktree.js'
import { getStatus, type WorktreeStatus } from '../git/status.js'
import { ensureRepoCache, resolveRepoCache } from '../repo/cache.js'
import { withRepoLock } from '../repo/lock.js'
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
}

export async function addRepo(
  ctx: WorkspaceContext,
  workspaceDir: string,
  options: AddRepoOptions,
): Promise<WorktreeEntry> {
  const { manifest } = await reconcileWorkspace(ctx, workspaceDir)

  const folder = options.folder ?? slugify(repoShortName(options.source))
  if (manifest.worktrees.some((wt) => wt.folder === folder)) {
    throw new SporkError(
      `"${folder}" is already used in workspace "${manifest.name}". Pass --as to choose a different folder name.`,
    )
  }

  const requestedRef = options.ref ?? 'HEAD'
  const worktreePath = path.join(workspaceDir, folder)
  const localBranch = `spork/${slugify(manifest.name)}/${slugify(folder)}`
  const cache = resolveRepoCache(ctx.reposRoot, options.source)

  await withRepoLock(cache.path, async () => {
    await ensureRepoCache(ctx.reposRoot, options.source)
    await addWorktree(cache.path, worktreePath, localBranch, requestedRef)
  })

  const entry: WorktreeEntry = {
    folder,
    source: options.source,
    requestedRef,
    localBranch,
    addedAt: new Date().toISOString(),
  }

  manifest.worktrees.push(entry)
  await writeManifest(workspaceDir, manifest)
  await writeCodeWorkspace(workspaceDir, manifest)

  return entry
}

export async function removeRepo(ctx: WorkspaceContext, workspaceDir: string, folder: string): Promise<void> {
  const { manifest } = await reconcileWorkspace(ctx, workspaceDir)

  const entry = manifest.worktrees.find((wt) => wt.folder === folder)
  if (!entry) {
    throw new SporkError(`No worktree named "${folder}" in workspace "${manifest.name}".`)
  }

  const cache = resolveRepoCache(ctx.reposRoot, entry.source)
  const worktreePath = path.join(workspaceDir, folder)

  await withRepoLock(cache.path, async () => {
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
