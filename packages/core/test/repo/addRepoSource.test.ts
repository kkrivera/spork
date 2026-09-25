import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/repo/cache.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/repo/cache.js')>('../../src/repo/cache.js')
  return { ...actual, ensureRepoCache: vi.fn() }
})
vi.mock('../../src/repo/lock.js', () => ({
  withRepoLock: vi.fn((_target: string, fn: () => Promise<unknown>) => fn()),
}))
vi.mock('../../src/registry/repoRegistry.js', () => ({
  listRepoAliases: vi.fn(),
  registerRepoAlias: vi.fn(),
  unregisterRepoAlias: vi.fn(),
  resolveRepoAlias: vi.fn(),
}))

const { ensureRepoCache } = await import('../../src/repo/cache.js')
const { listRepoAliases, registerRepoAlias, resolveRepoAlias } = await import('../../src/registry/repoRegistry.js')
const { addRepoSource, addRepoSourceOrAlias } = await import('../../src/repo/repos.js')
const { SporkError } = await import('../../src/errors.js')

const WIDGETS_SOURCE = 'git@github.com:acme/widgets.git'
const ctx = { reposRoot: '/repos', repoRegistryPath: '/registry.json' }

beforeEach(() => {
  vi.mocked(ensureRepoCache).mockReset().mockResolvedValue({ id: '', source: '', path: '', lockPath: '' })
  vi.mocked(listRepoAliases).mockReset().mockResolvedValue([])
  vi.mocked(registerRepoAlias).mockReset().mockResolvedValue(undefined)
  vi.mocked(resolveRepoAlias).mockReset().mockImplementation(async (_p, _r, input: string) => input)
})

describe('addRepoSource', () => {
  it('ensures the cache and registers a default short alias on first use', async () => {
    const entry = await addRepoSource(ctx, WIDGETS_SOURCE)

    expect(ensureRepoCache).toHaveBeenCalledWith('/repos', WIDGETS_SOURCE)
    expect(entry.alias).toBe('widgets')
    expect(registerRepoAlias).toHaveBeenCalledWith('/registry.json', {
      alias: 'widgets',
      source: WIDGETS_SOURCE,
      addedAt: entry.addedAt,
    })
  })

  it('is idempotent when the source is already registered and no alias is requested', async () => {
    const existing = { alias: 'widgets', source: WIDGETS_SOURCE, addedAt: 'yesterday' }
    vi.mocked(listRepoAliases).mockResolvedValue([existing])

    const entry = await addRepoSource(ctx, WIDGETS_SOURCE)

    expect(entry).toEqual(existing)
    expect(registerRepoAlias).not.toHaveBeenCalled()
    expect(ensureRepoCache).toHaveBeenCalled()
  })

  it('is idempotent when the requested alias matches the existing one', async () => {
    const existing = { alias: 'widgets', source: WIDGETS_SOURCE, addedAt: 'yesterday' }
    vi.mocked(listRepoAliases).mockResolvedValue([existing])

    const entry = await addRepoSource(ctx, WIDGETS_SOURCE, { alias: 'widgets' })

    expect(entry).toEqual(existing)
    expect(registerRepoAlias).not.toHaveBeenCalled()
  })

  it('registers a second alias for an already-known source when a different alias is requested', async () => {
    vi.mocked(listRepoAliases).mockResolvedValue([{ alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' }])

    const entry = await addRepoSource(ctx, WIDGETS_SOURCE, { alias: 'widgets-v2' })

    expect(entry.alias).toBe('widgets-v2')
    expect(registerRepoAlias).toHaveBeenCalledWith('/registry.json', expect.objectContaining({ alias: 'widgets-v2' }))
  })

  it('rejects an explicit alias that is already used by a different source', async () => {
    vi.mocked(listRepoAliases).mockResolvedValue([{ alias: 'widgets', source: 'git@github.com:other/x.git', addedAt: '' }])

    await expect(addRepoSource(ctx, WIDGETS_SOURCE, { alias: 'widgets' })).rejects.toThrow(SporkError)
    expect(registerRepoAlias).not.toHaveBeenCalled()
  })

  it('falls back to the fully-qualified cache id when the default short alias is taken by a different source', async () => {
    vi.mocked(listRepoAliases).mockResolvedValue([
      { alias: 'widgets', source: 'git@github.com:other/widgets.git', addedAt: '' },
    ])

    const entry = await addRepoSource(ctx, WIDGETS_SOURCE)

    expect(entry.alias).toMatch(/^widgets-[a-f0-9]{8}$/)
    expect(entry.alias).not.toBe('widgets')
  })
})

describe('addRepoSourceOrAlias', () => {
  it('resolves an alias to its source before ensuring the cache', async () => {
    vi.mocked(resolveRepoAlias).mockResolvedValue(WIDGETS_SOURCE)

    const entry = await addRepoSourceOrAlias(ctx, 'widgets')

    expect(resolveRepoAlias).toHaveBeenCalledWith('/registry.json', '/repos', 'widgets')
    expect(ensureRepoCache).toHaveBeenCalledWith('/repos', WIDGETS_SOURCE)
    expect(entry.source).toBe(WIDGETS_SOURCE)
  })

  it('passes a raw source straight through unchanged', async () => {
    await addRepoSourceOrAlias(ctx, WIDGETS_SOURCE)

    expect(ensureRepoCache).toHaveBeenCalledWith('/repos', WIDGETS_SOURCE)
  })
})
