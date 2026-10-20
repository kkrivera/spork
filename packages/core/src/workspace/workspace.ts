import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { addWorktree, isBranchExistsError, isWorktreeCollisionError, pruneWorktrees, removeWorktree } from '../git/worktree.js'
import { getStatus, type WorktreeStatus } from '../git/status.js'
import { hasSubmodules, initSubmodules } from '../git/submodule.js'
import { resolveRepoCache } from '../repo/cache.js'
import { withRepoLock } from '../repo/lock.js'
import { addRepoSource } from '../repo/repos.js'
import { adoptLocalRepo } from '../repo/scan.js'
import { localRepoRegistryPath, resolveScopedRepoAlias } from '../registry/repoRegistry.js'
import { listWorkspaces, registerWorkspace, unregisterWorkspace } from '../registry/registry.js'
import { slugify } from '../util/slug.js'
import { repoShortName } from '../util/repoName.js'
import { withFileLock } from '../util/fileLock.js'
import { SporkError } from '../errors.js'
import { codeWorkspaceFilePath, writeCodeWorkspace } from './codeWorkspace.js'
import {
  createManifest,
  manifestPath,
  readManifest,
  writeManifest,
  type AdoptedEntry,
  type ManifestEntry,
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

/**
 * Creates a workspace and registers it in one step — every caller that
 * creates a workspace at all needs both halves done together (an
 * unregistered workspace is orphaned from `spork workspace list`/`open`/
 * etc.; a registration with no actual workspace behind it is corrupt
 * state), so this is the one place that pairing lives rather than each
 * frontend (`@spork/cli`, `@spork/mcp`) re-implementing it. Checks for a
 * name collision against the registry *before* creating anything on disk,
 * so a duplicate name fails without leaving an orphaned directory behind
 * — `registerWorkspace` itself also rejects a collision, atomically inside
 * its own lock, as a backstop against the race between that check and the
 * registration (two concurrent creates of the same name), not as the
 * primary guard.
 */
export async function createAndRegisterWorkspace(
  ctx: WorkspaceContext,
  registryPath: string,
  options: CreateWorkspaceOptions,
): Promise<WorkspaceHandle> {
  const existing = await listWorkspaces(registryPath)
  if (existing.some((workspace) => workspace.name === options.name)) {
    throw new SporkError(`A workspace named "${options.name}" is already registered.`)
  }

  const handle = await createWorkspace(ctx, options)
  await registerWorkspace(registryPath, { name: options.name, dir: options.dir })
  return handle
}

export interface InitWorkspaceOptions {
  name: string
  /** The existing folder to turn into a workspace root, in place — unlike `CreateWorkspaceOptions.dir`, never created. */
  dir: string
}

/**
 * Turns an already-existing folder of plain git clones into a spork
 * workspace, in place — no `mkdir` (the folder is already there with real
 * content), and `origin: 'initialized'` rather than `'created'`, so
 * `removeWorkspace` below knows never to delete this directory. Doesn't
 * touch any repo itself — see `adoptRepoIntoWorkspace`, the separate,
 * per-folder step a caller runs afterward for each folder it wants in the
 * workspace (mirroring `createWorkspace`/`addRepo`'s own split).
 */
export async function initWorkspace(ctx: WorkspaceContext, options: InitWorkspaceOptions): Promise<WorkspaceHandle> {
  if (existsSync(manifestPath(options.dir))) {
    throw new SporkError(`"${options.dir}" is already a spork workspace.`)
  }

  const manifest = createManifest(options.name, 'initialized')
  await writeManifest(options.dir, manifest)
  await writeCodeWorkspace(options.dir, manifest)
  return { name: options.name, dir: options.dir, manifest }
}

/** `initWorkspace`, but also registered — see `createAndRegisterWorkspace`'s doc comment for why both halves always go together. */
export async function initAndRegisterWorkspace(
  ctx: WorkspaceContext,
  registryPath: string,
  options: InitWorkspaceOptions,
): Promise<WorkspaceHandle> {
  const existing = await listWorkspaces(registryPath)
  if (existing.some((workspace) => workspace.name === options.name)) {
    throw new SporkError(`A workspace named "${options.name}" is already registered.`)
  }

  const handle = await initWorkspace(ctx, options)
  await registerWorkspace(registryPath, { name: options.name, dir: options.dir })
  return handle
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
 *
 * The prune-write re-reads the manifest fresh from inside `withFileLock`
 * rather than reusing this function's own initial read, and only removes
 * the specific folders *this* call determined were gone — so a sibling
 * `addRepo` that wrote a new entry in the meantime (this runs concurrently
 * with every `--repo`/the interactive picker via `@spork/task-runner`)
 * doesn't get that entry silently dropped by a stale snapshot.
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
    await withFileLock(manifestPath(workspaceDir), async () => {
      const fresh = await readManifest(workspaceDir)
      fresh.worktrees = fresh.worktrees.filter((wt) => !removedFolders.includes(wt.folder))
      await writeManifest(workspaceDir, fresh)
      await writeCodeWorkspace(workspaceDir, fresh)
    })
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
  /** True if `localBranch` already existed in this repo's cache and was checked out as-is, rather than created fresh. */
  reusedExistingBranch: boolean
}

/**
 * `folder` must be unused in this workspace, and `source` must not already
 * be added under a different folder. Every repo in a workspace now shares
 * one branch (the workspace's own name, verbatim — see `addRepo`'s
 * `localBranch`), so the same repo can't be added twice: both worktrees
 * would need to check out the identical branch in the identical repo cache
 * at once, which git can't do. Catching that here gives a clear, specific
 * error rather than letting git's own "already checked out elsewhere"
 * surface confusingly later.
 */
function assertCanAddRepo(manifest: WorkspaceManifest, folder: string, source: string): void {
  if (manifest.worktrees.some((wt) => wt.folder === folder)) {
    throw new SporkError(
      `"${folder}" is already used in workspace "${manifest.name}". Pass --as to choose a different folder name.`,
    )
  }

  const alreadyAdded = manifest.worktrees.find((wt) => wt.source === source)
  if (alreadyAdded) {
    throw new SporkError(
      `"${source}" is already in workspace "${manifest.name}" (as "${alreadyAdded.folder}"). A workspace shares one branch per repo, so the same repo can only be added once.`,
    )
  }
}

/**
 * Creates the worktree — reusing `localBranch` as-is if it already exists in
 * this repo's cache (e.g. a previous, removed workspace of the same name
 * touched it before), or creating it fresh from `requestedRef` otherwise —
 * and returns whether it reused an existing branch. The one thing this
 * can't resolve is `localBranch` already being checked out *elsewhere*
 * right now (`isWorktreeCollisionError`; `isBranchExistsError` is kept as a
 * defensive fallback for a check-then-act race, though `addWorktree`'s own
 * existence check means it shouldn't normally fire) — a branch can only be
 * checked out in one worktree at a time, so that still becomes a clear
 * `SporkError` instead of letting git's own failure surface as-is.
 */
async function createWorktreeOrThrow(
  cache: { path: string; lockPath: string },
  worktreePath: string,
  localBranch: string,
  requestedRef: string,
  source: string,
): Promise<boolean> {
  try {
    const { reusedExistingBranch } = await withRepoLock(cache.lockPath, () =>
      addWorktree(cache.path, worktreePath, localBranch, requestedRef),
    )
    return reusedExistingBranch
  } catch (error) {
    if (isBranchExistsError(error) || isWorktreeCollisionError(error)) {
      throw new SporkError(
        `Branch "${localBranch}" is already checked out elsewhere in the cache for "${source}" (${cache.path}) and can't be reused here. Resolve that checkout first, or create this workspace under a different name.`,
      )
    }
    throw error
  }
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
  assertCanAddRepo(manifest, folder, source)

  const requestedRef = options.ref ?? 'HEAD'
  const worktreePath = path.join(workspaceDir, folder)
  // Verbatim, not slugified: every repo in this workspace shares this exact
  // branch name (including any "/" it contains — git ref names support "/"
  // as hierarchy, same as a "username/feature" convention), so it reads as
  // a real, pushable branch rather than spork-internal plumbing.
  const localBranch = manifest.name

  // addRepoSource ensures the cache is cloned/fetched and registers (or reuses) an alias for
  // it — its own short lock. addWorktree gets a separate, second lock: see repo/repos.ts.
  // The alias registers locally to this workspace by default — the target workspace is
  // always known here, unlike the standalone `repo add` command — with --global opting into
  // the shared registry instead.
  const aliasScope: 'local' | 'global' = options.global ? 'global' : 'local'
  const aliasRegistryPath = options.global ? ctx.repoRegistryPath : localRepoRegistryPath(workspaceDir)
  await addRepoSource({ reposRoot: ctx.reposRoot, repoRegistryPath: aliasRegistryPath }, source)

  const cache = resolveRepoCache(ctx.reposRoot, source)
  const reusedExistingBranch = await createWorktreeOrThrow(cache, worktreePath, localBranch, requestedRef, source)

  const entry: WorktreeEntry = {
    folder,
    source,
    requestedRef,
    localBranch,
    addedAt: new Date().toISOString(),
  }

  // Re-reads the manifest fresh from inside the lock rather than reusing
  // this call's own (possibly now-stale) `manifest` — `--repo a --repo b
  // --repo c`/the interactive picker add every repo concurrently via
  // @spork/task-runner, so by the time this runs, a sibling call may
  // already have written its own entry. Pushing onto the stale in-memory
  // `manifest` and writing that back would silently clobber it. (A
  // narrower race — two concurrent adds resolving to the exact same
  // folder name — isn't re-checked here; the lock's job is just to stop
  // writes from stomping on each other, not to add new validation.)
  await withFileLock(manifestPath(workspaceDir), async () => {
    const fresh = await readManifest(workspaceDir)
    fresh.worktrees.push(entry)
    await writeManifest(workspaceDir, fresh)
    await writeCodeWorkspace(workspaceDir, fresh)
  })

  // Submodule init is per-worktree, not shared-cache state, so it runs after
  // the lock is released — no reason to hold up other spork operations on
  // this repo's cache while (potentially slow) submodule clones happen. A
  // failure here doesn't undo the worktree/manifest entry above: the repo
  // itself checked out fine, so the add is still considered successful.
  if (!hasSubmodules(worktreePath)) {
    return { entry, aliasScope, submodulesInitialized: false, reusedExistingBranch }
  }

  try {
    await initSubmodules(worktreePath)
    return { entry, aliasScope, submodulesInitialized: true, reusedExistingBranch }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { entry, aliasScope, submodulesInitialized: false, submoduleWarning: message, reusedExistingBranch }
  }
}

/**
 * Adopts the git repo already sitting at `<workspaceDir>/<folder>` into
 * spork's shared cache (if it isn't already known there) and records it in
 * the manifest as an `AdoptedEntry` — never a worktree, never a branch
 * change, no matter what. The building block `workspace init`'s CLI command
 * loops over (one call per selected folder, via `runConcurrently`), the same
 * way `addReposBatch.ts` loops `addRepo` — not something this module itself
 * loops over, so it stays independently callable/concurrency-safe.
 */
export async function adoptRepoIntoWorkspace(
  ctx: WorkspaceContext,
  workspaceDir: string,
  folder: string,
): Promise<AdoptedEntry> {
  const repoCtx = { reposRoot: ctx.reposRoot, repoRegistryPath: localRepoRegistryPath(workspaceDir) }
  const { source } = await adoptLocalRepo(repoCtx, path.join(workspaceDir, folder))
  const entry: AdoptedEntry = { kind: 'adopted', folder, source, addedAt: new Date().toISOString() }

  // Same re-read-fresh-inside-the-lock pattern as `addRepo`'s tail — several
  // of these run concurrently (one per selected folder), so a stale
  // in-memory manifest here would silently clobber a sibling's entry.
  await withFileLock(manifestPath(workspaceDir), async () => {
    const fresh = await readManifest(workspaceDir)
    fresh.worktrees.push(entry)
    await writeManifest(workspaceDir, fresh)
    await writeCodeWorkspace(workspaceDir, fresh)
  })

  return entry
}

export async function removeRepo(ctx: WorkspaceContext, workspaceDir: string, folder: string): Promise<void> {
  const { manifest } = await reconcileWorkspace(ctx, workspaceDir)

  const entry = manifest.worktrees.find((wt) => wt.folder === folder)
  if (!entry) {
    throw new SporkError(`No worktree named "${folder}" in workspace "${manifest.name}".`)
  }

  // An adopted entry was never a git worktree — it's just dropped from the
  // manifest below, same as every other kind, but with no cache/worktree to
  // touch first. See `AdoptedEntry`'s doc comment for why.
  if (entry.kind !== 'adopted') {
    const cache = resolveRepoCache(ctx.reposRoot, entry.source)
    const worktreePath = path.join(workspaceDir, folder)

    await withRepoLock(cache.lockPath, async () => {
      await removeWorktree(cache.path, worktreePath, { force: true })
    })
  }

  // Same re-read-fresh-inside-the-lock reasoning as `addRepo` — not
  // currently called concurrently by any wired command, but kept
  // consistent so that stays true by construction rather than by accident.
  await withFileLock(manifestPath(workspaceDir), async () => {
    const fresh = await readManifest(workspaceDir)
    fresh.worktrees = fresh.worktrees.filter((wt) => wt.folder !== folder)
    await writeManifest(workspaceDir, fresh)
    await writeCodeWorkspace(workspaceDir, fresh)
  })
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

  // An initialized workspace's directory is the user's own pre-existing
  // folder, not something spork created — removal only ever drops spork's
  // own bookkeeping files, never the directory (or anything inside it;
  // every entry's own removal above already left its folder alone too).
  if (manifest.origin === 'initialized') {
    await rm(manifestPath(workspaceDir), { force: true })
    await rm(codeWorkspaceFilePath(workspaceDir, manifest.name), { force: true })
    return
  }

  await rm(workspaceDir, { recursive: true, force: true })
}

/**
 * Removes a workspace and drops its registry entry in one step — the same
 * "every caller needs both halves done together" reasoning as
 * `createAndRegisterWorkspace`: a workspace removed but still registered
 * would show up in `spork workspace list`/`open` pointing at nothing.
 * Looks up the registry entry by `workspaceDir` *after* removal (rather
 * than requiring the caller to already know the matching name) since a
 * caller typically only has the resolved directory at this point, not
 * necessarily the exact registered name it came from.
 */
export async function removeAndUnregisterWorkspace(
  ctx: WorkspaceContext,
  registryPath: string,
  workspaceDir: string,
  options: RemoveWorkspaceOptions = {},
): Promise<void> {
  await removeWorkspace(ctx, workspaceDir, options)

  const registered = await listWorkspaces(registryPath)
  const match = registered.find((workspace) => workspace.dir === workspaceDir)
  if (match) await unregisterWorkspace(registryPath, match.name)
}

export type WorktreeStatusEntry = ManifestEntry & { status: WorktreeStatus }

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
