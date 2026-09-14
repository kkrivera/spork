import { mkdtemp, rm } from 'node:fs/promises'
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

const { addWorktree } = await import('../../src/git/worktree.js')
const { ensureRepoCache, resolveRepoCache } = await import('../../src/repo/cache.js')
const { createWorkspace, addRepo } = await import('../../src/workspace/workspace.js')
const { readManifest } = await import('../../src/workspace/manifest.js')
const { SporkError } = await import('../../src/errors.js')
const { fakeAddWorktree } = await import('./fakeAddWorktree.js')

const addWorktreeMock = vi.mocked(addWorktree)
const ensureRepoCacheMock = vi.mocked(ensureRepoCache)
const WIDGETS_SOURCE = 'git@github.com:acme/widgets.git'

let root: string
let dir: string
const ctx = { reposRoot: '' }

function widgetsCachePath(): string {
  return resolveRepoCache(ctx.reposRoot, WIDGETS_SOURCE).path
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'spork-addrepo-'))
  dir = path.join(root, 'demo')
  ctx.reposRoot = path.join(root, 'repos')
  await createWorkspace(ctx, { name: 'demo', dir })
  addWorktreeMock.mockReset().mockImplementation(fakeAddWorktree)
  ensureRepoCacheMock.mockReset().mockResolvedValue({ id: 'widgets-abc', source: '', path: '/unused' })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('addRepo', () => {
  it('adds a worktree on a spork-owned branch and records it in the manifest', async () => {
    const entry = await addRepo(ctx, dir, { source: WIDGETS_SOURCE })

    expect(entry).toMatchObject({
      folder: 'widgets',
      source: WIDGETS_SOURCE,
      requestedRef: 'HEAD',
      localBranch: 'spork/demo/widgets',
    })
    expect(addWorktreeMock).toHaveBeenCalledWith(widgetsCachePath(), path.join(dir, 'widgets'), 'spork/demo/widgets', 'HEAD')
    expect(ensureRepoCacheMock).toHaveBeenCalledWith(ctx.reposRoot, WIDGETS_SOURCE)
    expect((await readManifest(dir)).worktrees).toEqual([entry])
  })

  it('uses the requested ref as the worktree start point', async () => {
    await addRepo(ctx, dir, { source: WIDGETS_SOURCE, ref: 'release/2.0' })

    expect(addWorktreeMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 'release/2.0')
  })

  it('honors an explicit --as folder name', async () => {
    const entry = await addRepo(ctx, dir, { source: WIDGETS_SOURCE, folder: 'widgets-v2' })

    expect(entry.folder).toBe('widgets-v2')
    expect(entry.localBranch).toBe('spork/demo/widgets-v2')
  })

  it('rejects a second worktree with the same folder name', async () => {
    await addRepo(ctx, dir, { source: WIDGETS_SOURCE })
    addWorktreeMock.mockClear()

    await expect(addRepo(ctx, dir, { source: 'git@github.com:other/widgets.git' })).rejects.toThrow(SporkError)
    expect(addWorktreeMock).not.toHaveBeenCalled()
  })

  it('allows the same repo+branch to be added twice under different folder names', async () => {
    await addRepo(ctx, dir, { source: WIDGETS_SOURCE, ref: 'main', folder: 'widgets-a' })
    await addRepo(ctx, dir, { source: WIDGETS_SOURCE, ref: 'main', folder: 'widgets-b' })

    const manifest = await readManifest(dir)
    expect(manifest.worktrees.map((wt) => wt.localBranch)).toEqual([
      'spork/demo/widgets-a',
      'spork/demo/widgets-b',
    ])
  })
})
