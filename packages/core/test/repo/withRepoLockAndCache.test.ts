import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/git/clone.js', () => ({
  cloneBare: vi.fn(),
}))
vi.mock('../../src/git/fetch.js', () => ({
  fetchRef: vi.fn(),
}))

const { cloneBare } = await import('../../src/git/clone.js')
const { fetchRef } = await import('../../src/git/fetch.js')
const { resolveRepoCache, ensureRepoCache } = await import('../../src/repo/cache.js')
const { withRepoLock } = await import('../../src/repo/lock.js')

const cloneBareMock = vi.mocked(cloneBare)
const fetchRefMock = vi.mocked(fetchRef)

let reposRoot: string

beforeEach(async () => {
  reposRoot = await mkdtemp(path.join(os.tmpdir(), 'spork-lock-cache-'))
  cloneBareMock.mockReset().mockResolvedValue(undefined)
  fetchRefMock.mockReset().mockResolvedValue(undefined)
})

afterEach(async () => {
  await rm(reposRoot, { recursive: true, force: true })
})

describe('withRepoLock + ensureRepoCache, wired the way workspace.ts wires them', () => {
  it('still clones on first use even though locking pre-creates a directory of its own', async () => {
    // Regression: withRepoLock creates whatever path it's given before locking
    // it. If that path were the cache's own `path` (as it once was), this
    // real, unmocked mkdir would make ensureRepoCache see an (empty) directory
    // already there and wrongly skip cloning. Locking `lockPath` instead keeps
    // that side effect away from `path` entirely.
    const cache = resolveRepoCache(reposRoot, 'git@github.com:acme/widgets.git')

    await withRepoLock(cache.lockPath, async () => {
      await ensureRepoCache(reposRoot, 'git@github.com:acme/widgets.git')
    })

    expect(cloneBareMock).toHaveBeenCalledWith('git@github.com:acme/widgets.git', cache.path, {})
    expect(fetchRefMock).not.toHaveBeenCalled()
  })
})
