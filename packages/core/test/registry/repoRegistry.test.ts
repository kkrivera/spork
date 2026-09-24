import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  listRepoAliases,
  registerRepoAlias,
  resolveRepoAlias,
  unregisterRepoAlias,
} from '../../src/registry/repoRegistry.js'
import { resolveRepoCache } from '../../src/repo/cache.js'
import { SporkError } from '../../src/errors.js'

let root: string
let registryPath: string
let reposRoot: string

const WIDGETS_SOURCE = 'git@github.com:acme/widgets.git'

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
