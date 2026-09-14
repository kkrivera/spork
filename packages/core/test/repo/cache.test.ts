import { describe, expect, it, vi, beforeEach } from 'vitest'

const existsSyncMock = vi.fn()
const mkdirMock = vi.fn()

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
}))
vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mkdirMock(...args),
}))
vi.mock('../../src/git/clone.js', () => ({
  cloneBare: vi.fn(),
  fetchAll: vi.fn(),
}))

const { cloneBare, fetchAll } = await import('../../src/git/clone.js')
const { repoCacheId, resolveRepoCache, ensureRepoCache } = await import('../../src/repo/cache.js')

const cloneBareMock = vi.mocked(cloneBare)
const fetchAllMock = vi.mocked(fetchAll)

beforeEach(() => {
  existsSyncMock.mockReset()
  mkdirMock.mockReset().mockResolvedValue(undefined)
  cloneBareMock.mockReset().mockResolvedValue(undefined)
  fetchAllMock.mockReset().mockResolvedValue(undefined)
})

describe('repoCacheId', () => {
  it('derives a readable, stable id from a remote URL', () => {
    const id = repoCacheId('git@github.com:acme/widgets.git')

    expect(id).toMatch(/^widgets-[a-f0-9]{8}$/)
    expect(repoCacheId('git@github.com:acme/widgets.git')).toBe(id)
  })

  it('gives different ids to different sources with the same short name', () => {
    const a = repoCacheId('git@github.com:acme/widgets.git')
    const b = repoCacheId('git@example.com:other/widgets.git')

    expect(a).not.toBe(b)
  })

  it('falls back to a safe slug for an unusual source string', () => {
    expect(repoCacheId('///')).toMatch(/^repo-[a-f0-9]{8}$/)
  })
})

describe('resolveRepoCache', () => {
  it('joins the repos root with the derived id', () => {
    const cache = resolveRepoCache('/home/user/.spork/repos', 'git@github.com:acme/widgets.git')

    expect(cache.source).toBe('git@github.com:acme/widgets.git')
    expect(cache.path).toBe(`/home/user/.spork/repos/${cache.id}`)
  })
})

describe('ensureRepoCache', () => {
  it('clones when the cache does not exist yet', async () => {
    existsSyncMock.mockReturnValue(false)

    const cache = await ensureRepoCache('/repos', 'git@github.com:acme/widgets.git')

    expect(mkdirMock).toHaveBeenCalledWith('/repos', { recursive: true })
    expect(cloneBareMock).toHaveBeenCalledWith('git@github.com:acme/widgets.git', cache.path)
    expect(fetchAllMock).not.toHaveBeenCalled()
  })

  it('fetches instead of re-cloning when the cache already exists', async () => {
    existsSyncMock.mockReturnValue(true)

    const cache = await ensureRepoCache('/repos', 'git@github.com:acme/widgets.git')

    expect(fetchAllMock).toHaveBeenCalledWith(cache.path)
    expect(cloneBareMock).not.toHaveBeenCalled()
  })
})
