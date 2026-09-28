import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  listRepoAliases,
  localRepoRegistryPath,
  registerRepoAlias,
  resolveRepoAlias,
  resolveScopedRepoAlias,
  unregisterRepoAlias,
} from '../../src/registry/repoRegistry.js'
import { resolveRepoCache } from '../../src/repo/cache.js'
import { SporkError } from '../../src/errors.js'

let root: string
let registryPath: string
let reposRoot: string

const WIDGETS_SOURCE = 'git@github.com:acme/widgets.git'
const GADGETS_SOURCE = 'git@github.com:acme/gadgets.git'

/** Simulates a real bare clone existing in the cache, without spawning git. */
async function fakeClone(source: string): Promise<void> {
  const cachePath = resolveRepoCache(reposRoot, source).path
  await mkdir(cachePath, { recursive: true })
  await writeFile(path.join(cachePath, 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'spork-repo-registry-'))
  registryPath = path.join(root, 'repos.json')
  reposRoot = path.join(root, 'repos')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('registerRepoAlias / listRepoAliases', () => {
  it('starts empty when no registry file exists yet', async () => {
    expect(await listRepoAliases(registryPath, reposRoot)).toEqual([])
  })

  it('registers and lists an alias', async () => {
    await fakeClone(WIDGETS_SOURCE)
    await registerRepoAlias(registryPath, { alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' })

    expect(await listRepoAliases(registryPath, reposRoot)).toEqual([
      { alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' },
    ])
  })

  it('rejects registering an alias that is already taken', async () => {
    await fakeClone(WIDGETS_SOURCE)
    await registerRepoAlias(registryPath, { alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' })

    await expect(
      registerRepoAlias(registryPath, { alias: 'widgets', source: 'git@github.com:other/x.git', addedAt: '' }),
    ).rejects.toThrow(SporkError)
  })

  it('drops and persists the removal of an alias whose cache is gone', async () => {
    await fakeClone(WIDGETS_SOURCE)
    await registerRepoAlias(registryPath, { alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' })
    await rm(resolveRepoCache(reposRoot, WIDGETS_SOURCE).path, { recursive: true, force: true })

    expect(await listRepoAliases(registryPath, reposRoot)).toEqual([])
    expect(await listRepoAliases(registryPath, reposRoot)).toEqual([])
  })
})

describe('unregisterRepoAlias', () => {
  it('removes an entry by alias', async () => {
    await fakeClone(WIDGETS_SOURCE)
    await registerRepoAlias(registryPath, { alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' })

    await unregisterRepoAlias(registryPath, 'widgets')

    expect(await listRepoAliases(registryPath, reposRoot)).toEqual([])
  })

  it('is a no-op for an alias that was never registered', async () => {
    await expect(unregisterRepoAlias(registryPath, 'ghost')).resolves.toBeUndefined()
  })
})

describe('resolveRepoAlias', () => {
  it('resolves a registered alias to its source', async () => {
    await fakeClone(WIDGETS_SOURCE)
    await registerRepoAlias(registryPath, { alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' })

    expect(await resolveRepoAlias(registryPath, reposRoot, 'widgets')).toBe(WIDGETS_SOURCE)
  })

  it('falls back to treating the input as a raw source', async () => {
    expect(await resolveRepoAlias(registryPath, reposRoot, WIDGETS_SOURCE)).toBe(WIDGETS_SOURCE)
  })
})

describe('localRepoRegistryPath', () => {
  it('sits next to spork.workspace.json, distinct from the manifest', () => {
    expect(localRepoRegistryPath('/ws/demo')).toBe(path.join('/ws/demo', 'spork.repos.json'))
  })
})

describe('resolveScopedRepoAlias', () => {
  let localRegistryPath: string

  beforeEach(() => {
    localRegistryPath = path.join(root, 'local-repos.json')
  })

  it('prefers a local match over a global one for the same alias', async () => {
    await fakeClone(WIDGETS_SOURCE)
    await fakeClone(GADGETS_SOURCE)
    await registerRepoAlias(registryPath, { alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' })
    await registerRepoAlias(localRegistryPath, { alias: 'widgets', source: GADGETS_SOURCE, addedAt: '' })

    const resolved = await resolveScopedRepoAlias(reposRoot, localRegistryPath, registryPath, 'widgets')

    expect(resolved).toBe(GADGETS_SOURCE)
  })

  it('falls back to the global registry when there is no local match', async () => {
    await fakeClone(WIDGETS_SOURCE)
    await registerRepoAlias(registryPath, { alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' })

    const resolved = await resolveScopedRepoAlias(reposRoot, localRegistryPath, registryPath, 'widgets')

    expect(resolved).toBe(WIDGETS_SOURCE)
  })

  it('falls back straight to global when there is no local registry at all', async () => {
    await fakeClone(WIDGETS_SOURCE)
    await registerRepoAlias(registryPath, { alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' })

    const resolved = await resolveScopedRepoAlias(reposRoot, null, registryPath, 'widgets')

    expect(resolved).toBe(WIDGETS_SOURCE)
  })

  it('falls back to the raw input when nothing matches in either scope', async () => {
    const resolved = await resolveScopedRepoAlias(reposRoot, localRegistryPath, registryPath, WIDGETS_SOURCE)

    expect(resolved).toBe(WIDGETS_SOURCE)
  })
})
