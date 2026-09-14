import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/repo/cache.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/repo/cache.js')>('../../src/repo/cache.js')
  return { ...actual, ensureRepoCache: vi.fn() }
})
vi.mock('../../src/repo/lock.js', () => ({
  withRepoLock: vi.fn((_target: string, fn: () => Promise<unknown>) => fn()),
}))
vi.mock('../../src/git/worktree.js', () => ({
  addWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  pruneWorktrees: vi.fn(),
}))

const { addWorktree, pruneWorktrees } = await import('../../src/git/worktree.js')
const { ensureRepoCache, resolveRepoCache } = await import('../../src/repo/cache.js')
const { createWorkspace, addRepo, reconcileWorkspace } = await import('../../src/workspace/workspace.js')
const { readManifest } = await import('../../src/workspace/manifest.js')
const { fakeAddWorktree } = await import('./fakeAddWorktree.js')

const WIDGETS_SOURCE = 'git@github.com:acme/widgets.git'

let root: string
let dir: string
const ctx = { reposRoot: '' }

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'spork-reconcile-'))
  dir = path.join(root, 'demo')
  ctx.reposRoot = path.join(root, 'repos')
  await createWorkspace(ctx, { name: 'demo', dir })
  vi.mocked(addWorktree).mockReset().mockImplementation(fakeAddWorktree)
  vi.mocked(pruneWorktrees).mockReset().mockResolvedValue(undefined)
  vi.mocked(ensureRepoCache).mockReset().mockResolvedValue({ id: 'widgets-abc', source: '', path: '/unused' })
  await addRepo(ctx, dir, { source: WIDGETS_SOURCE })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('reconcileWorkspace', () => {
  it('drops manifest entries whose folder was deleted by hand, and regenerates the .code-workspace', async () => {
    await rm(path.join(dir, 'widgets'), { recursive: true, force: true })

    const result = await reconcileWorkspace(ctx, dir)

    expect(result.removedFolders).toEqual(['widgets'])
    expect(result.manifest.worktrees).toEqual([])
    expect((await readManifest(dir)).worktrees).toEqual([])
  })

  it('leaves the manifest untouched when every folder still exists', async () => {
    const result = await reconcileWorkspace(ctx, dir)

    expect(result.removedFolders).toEqual([])
    expect(result.manifest.worktrees).toHaveLength(1)
  })

  it('prunes the repo cache when it exists on disk', async () => {
    const cachePath = resolveRepoCache(ctx.reposRoot, WIDGETS_SOURCE).path
    await mkdir(cachePath, { recursive: true })

    await reconcileWorkspace(ctx, dir)

    expect(pruneWorktrees).toHaveBeenCalledWith(cachePath)
  })

  it('does not try to prune a repo cache that was never created', async () => {
    await reconcileWorkspace(ctx, dir)

    expect(pruneWorktrees).not.toHaveBeenCalled()
  })
})
