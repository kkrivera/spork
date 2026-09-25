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
vi.mock('../../src/git/status.js', () => ({
  getStatus: vi.fn(),
}))

const { addWorktree } = await import('../../src/git/worktree.js')
const { getStatus } = await import('../../src/git/status.js')
const { ensureRepoCache } = await import('../../src/repo/cache.js')
const { createWorkspace, addRepo, getWorkspaceStatus } = await import('../../src/workspace/workspace.js')
const { fakeAddWorktree } = await import('./fakeAddWorktree.js')

let root: string
let dir: string
const ctx = { reposRoot: '', repoRegistryPath: '' }

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'spork-status-'))
  dir = path.join(root, 'demo')
  ctx.reposRoot = path.join(root, 'repos')
  ctx.repoRegistryPath = path.join(root, 'repos.json')
  await createWorkspace(ctx, { name: 'demo', dir })
  vi.mocked(addWorktree).mockReset().mockImplementation(fakeAddWorktree)
  vi.mocked(ensureRepoCache).mockReset().mockResolvedValue({ id: 'widgets-abc', source: '', path: '/unused' })
  vi.mocked(getStatus).mockReset().mockResolvedValue({ branch: 'spork/demo/widgets', isClean: true, changedFiles: 0 })
  await addRepo(ctx, dir, { source: 'git@github.com:acme/widgets.git' })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('getWorkspaceStatus', () => {
  it('merges each worktree entry with its local git status', async () => {
    const result = await getWorkspaceStatus(ctx, dir)

    expect(result).toEqual([
      expect.objectContaining({
        folder: 'widgets',
        status: { branch: 'spork/demo/widgets', isClean: true, changedFiles: 0 },
      }),
    ])
    expect(getStatus).toHaveBeenCalledWith(path.join(dir, 'widgets'))
  })

  it('returns an empty list for a workspace with no worktrees', async () => {
    const empty = path.join(root, 'empty')
    await createWorkspace(ctx, { name: 'empty', dir: empty })

    expect(await getWorkspaceStatus(ctx, empty)).toEqual([])
  })
})
