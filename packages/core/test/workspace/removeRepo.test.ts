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

const { addWorktree, removeWorktree } = await import('../../src/git/worktree.js')
const { ensureRepoCache, resolveRepoCache } = await import('../../src/repo/cache.js')
const { createWorkspace, addRepo, removeRepo } = await import('../../src/workspace/workspace.js')
const { readManifest } = await import('../../src/workspace/manifest.js')
const { SporkError } = await import('../../src/errors.js')
const { fakeAddWorktree } = await import('./fakeAddWorktree.js')

const addWorktreeMock = vi.mocked(addWorktree)
const removeWorktreeMock = vi.mocked(removeWorktree)
const WIDGETS_SOURCE = 'git@github.com:acme/widgets.git'

let root: string
let dir: string
const ctx = { reposRoot: '', repoRegistryPath: '' }

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'spork-removerepo-'))
  dir = path.join(root, 'demo')
  ctx.reposRoot = path.join(root, 'repos')
  ctx.repoRegistryPath = path.join(root, 'repos.json')
  await createWorkspace(ctx, { name: 'demo', dir })
  addWorktreeMock.mockReset().mockImplementation(fakeAddWorktree)
  removeWorktreeMock.mockReset().mockResolvedValue(undefined)
  vi.mocked(ensureRepoCache).mockReset().mockResolvedValue({ id: 'widgets-abc', source: '', path: '/unused' })
  await addRepo(ctx, dir, { source: WIDGETS_SOURCE })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('removeRepo', () => {
  it('force-removes the worktree and drops it from the manifest', async () => {
    await removeRepo(ctx, dir, 'widgets')

    expect(removeWorktreeMock).toHaveBeenCalledWith(
      resolveRepoCache(ctx.reposRoot, WIDGETS_SOURCE).path,
      path.join(dir, 'widgets'),
      { force: true },
    )
    expect((await readManifest(dir)).worktrees).toEqual([])
  })

  it('rejects removing a folder that is not in the workspace', async () => {
    await expect(removeRepo(ctx, dir, 'does-not-exist')).rejects.toThrow(SporkError)
    expect(removeWorktreeMock).not.toHaveBeenCalled()
  })
})
