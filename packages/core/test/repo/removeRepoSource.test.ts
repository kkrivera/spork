import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', () => ({ rm: vi.fn() }))
vi.mock('../../src/repo/lock.js', () => ({
  withRepoLock: vi.fn((_target: string, fn: () => Promise<unknown>) => fn()),
}))
vi.mock('../../src/registry/repoRegistry.js', () => ({
  listRepoAliases: vi.fn(),
  unregisterRepoAlias: vi.fn(),
  localRepoRegistryPath: (workspaceDir: string) => `${workspaceDir}/spork.repos.json`,
}))
vi.mock('../../src/registry/registry.js', () => ({
  listWorkspaces: vi.fn(),
}))
vi.mock('../../src/workspace/manifest.js', () => ({
  readManifest: vi.fn(),
}))

const { rm } = await import('node:fs/promises')
const { listRepoAliases, unregisterRepoAlias } = await import('../../src/registry/repoRegistry.js')
const { listWorkspaces } = await import('../../src/registry/registry.js')
const { readManifest } = await import('../../src/workspace/manifest.js')
const { resolveRepoCache } = await import('../../src/repo/cache.js')
const { findRepoUsages, removeRepoSource, removeLocalRepoAlias } = await import('../../src/repo/repos.js')
const { SporkError } = await import('../../src/errors.js')

const WIDGETS_SOURCE = 'git@github.com:acme/widgets.git'
const ctx = { reposRoot: '/repos', repoRegistryPath: '/repos.json', workspaceRegistryPath: '/workspaces.json' }

beforeEach(() => {
  vi.mocked(rm).mockReset().mockResolvedValue(undefined)
  vi.mocked(listRepoAliases).mockReset().mockResolvedValue([{ alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' }])
  vi.mocked(unregisterRepoAlias).mockReset().mockResolvedValue(undefined)
  vi.mocked(listWorkspaces).mockReset().mockResolvedValue([])
  vi.mocked(readManifest).mockReset()
})

describe('findRepoUsages', () => {
  it('finds every workspace/folder checked out from a source', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([
      { name: 'demo', dir: '/ws/demo' },
      { name: 'other', dir: '/ws/other' },
    ])
    vi.mocked(readManifest).mockImplementation(async (dir: string) => {
      if (dir === '/ws/demo') {
        return {
          name: 'demo',
          createdAt: '',
          worktrees: [{ folder: 'widgets', source: WIDGETS_SOURCE, requestedRef: '', localBranch: '', addedAt: '' }],
        }
      }
      return { name: 'other', createdAt: '', worktrees: [] }
    })

    expect(await findRepoUsages(ctx, WIDGETS_SOURCE)).toEqual([{ workspaceName: 'demo', folder: 'widgets' }])
  })

  it('returns an empty list when nothing references the source', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    vi.mocked(readManifest).mockResolvedValue({ name: 'demo', createdAt: '', worktrees: [] })

    expect(await findRepoUsages(ctx, WIDGETS_SOURCE)).toEqual([])
  })
})

describe('removeRepoSource', () => {
  it('deletes the cache and forgets the alias when nothing references it', async () => {
    await removeRepoSource(ctx, 'widgets')

    expect(rm).toHaveBeenCalledWith(resolveRepoCache('/repos', WIDGETS_SOURCE).path, { recursive: true, force: true })
    expect(unregisterRepoAlias).toHaveBeenCalledWith('/repos.json', 'widgets')
  })

  it('refuses to remove an alias still used by a workspace', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    vi.mocked(readManifest).mockResolvedValue({
      name: 'demo',
      createdAt: '',
      worktrees: [{ folder: 'widgets', source: WIDGETS_SOURCE, requestedRef: '', localBranch: '', addedAt: '' }],
    })

    await expect(removeRepoSource(ctx, 'widgets')).rejects.toThrow(SporkError)
    expect(rm).not.toHaveBeenCalled()
    expect(unregisterRepoAlias).not.toHaveBeenCalled()
  })

  it('rejects an alias that is not registered', async () => {
    vi.mocked(listRepoAliases).mockResolvedValue([])

    await expect(removeRepoSource(ctx, 'ghost')).rejects.toThrow(SporkError)
    expect(rm).not.toHaveBeenCalled()
  })
})

describe('removeLocalRepoAlias', () => {
  it('reads and unregisters from the workspace-local registry, not the global one', async () => {
    await removeLocalRepoAlias(ctx, '/ws/demo', 'widgets')

    expect(listRepoAliases).toHaveBeenCalledWith('/ws/demo/spork.repos.json', '/repos')
    expect(unregisterRepoAlias).toHaveBeenCalledWith('/ws/demo/spork.repos.json', 'widgets')
    expect(rm).toHaveBeenCalledWith(resolveRepoCache('/repos', WIDGETS_SOURCE).path, { recursive: true, force: true })
  })

  it('still refuses when a DIFFERENT workspace references the same source — the cache is shared regardless of alias scope', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'other-workspace', dir: '/ws/other' }])
    vi.mocked(readManifest).mockResolvedValue({
      name: 'other-workspace',
      createdAt: '',
      worktrees: [{ folder: 'widgets', source: WIDGETS_SOURCE, requestedRef: '', localBranch: '', addedAt: '' }],
    })

    await expect(removeLocalRepoAlias(ctx, '/ws/demo', 'widgets')).rejects.toThrow(SporkError)
    expect(rm).not.toHaveBeenCalled()
    expect(unregisterRepoAlias).not.toHaveBeenCalled()
  })
})
