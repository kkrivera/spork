import { existsSync } from 'node:fs'
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
const { ensureRepoCache } = await import('../../src/repo/cache.js')
const { createWorkspace, addRepo, removeWorkspace } = await import('../../src/workspace/workspace.js')
const { fakeAddWorktree } = await import('./fakeAddWorktree.js')

let root: string
let dir: string
const ctx = { reposRoot: '', repoRegistryPath: '' }

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'spork-remove-'))
  dir = path.join(root, 'demo')
  ctx.reposRoot = path.join(root, 'repos')
  ctx.repoRegistryPath = path.join(root, 'repos.json')
  await createWorkspace(ctx, { name: 'demo', dir })
  vi.mocked(addWorktree).mockReset().mockImplementation(fakeAddWorktree)
  vi.mocked(removeWorktree).mockReset().mockResolvedValue(undefined)
  vi.mocked(ensureRepoCache).mockReset().mockResolvedValue({ id: 'widgets-abc', source: '', path: '/unused' })
  await addRepo(ctx, dir, { source: 'git@github.com:acme/widgets.git' })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('removeWorkspace', () => {
  it('removes every worktree and deletes the workspace directory by default', async () => {
    await removeWorkspace(ctx, dir)

    expect(removeWorktree).toHaveBeenCalledTimes(1)
    expect(existsSync(dir)).toBe(false)
  })

  it('leaves everything untouched when keepFiles is set', async () => {
    await removeWorkspace(ctx, dir, { keepFiles: true })

    expect(removeWorktree).not.toHaveBeenCalled()
    expect(existsSync(dir)).toBe(true)
  })
})
