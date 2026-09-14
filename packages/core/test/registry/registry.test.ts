import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  listWorkspaces,
  registerWorkspace,
  resolveWorkspaceDir,
  unregisterWorkspace,
} from '../../src/registry/registry.js'
import { manifestPath } from '../../src/workspace/manifest.js'
import { SporkError } from '../../src/errors.js'

let root: string
let registryPath: string

async function makeWorkspaceDir(name: string): Promise<string> {
  const dir = path.join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(manifestPath(dir), JSON.stringify({ name, createdAt: '', worktrees: [] }), 'utf8')
  return dir
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'spork-registry-'))
  registryPath = path.join(root, 'workspaces.json')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('registerWorkspace / listWorkspaces', () => {
  it('starts empty when no registry file exists yet', async () => {
    expect(await listWorkspaces(registryPath)).toEqual([])
  })

  it('registers and lists a workspace', async () => {
    const dir = await makeWorkspaceDir('demo')

    await registerWorkspace(registryPath, { name: 'demo', dir })

    expect(await listWorkspaces(registryPath)).toEqual([{ name: 'demo', dir }])
  })

  it('rejects registering a name that is already taken', async () => {
    const dir = await makeWorkspaceDir('demo')
    await registerWorkspace(registryPath, { name: 'demo', dir })

    await expect(registerWorkspace(registryPath, { name: 'demo', dir })).rejects.toThrow(SporkError)
  })

  it('drops and persists the removal of an entry whose manifest is gone', async () => {
    const dir = await makeWorkspaceDir('demo')
    await registerWorkspace(registryPath, { name: 'demo', dir })
    await rm(dir, { recursive: true, force: true })

    expect(await listWorkspaces(registryPath)).toEqual([])
    expect(await listWorkspaces(registryPath)).toEqual([])
  })
})

describe('unregisterWorkspace', () => {
  it('removes an entry by name', async () => {
    const dir = await makeWorkspaceDir('demo')
    await registerWorkspace(registryPath, { name: 'demo', dir })

    await unregisterWorkspace(registryPath, 'demo')

    expect(await listWorkspaces(registryPath)).toEqual([])
  })

  it('is a no-op for a name that was never registered', async () => {
    await expect(unregisterWorkspace(registryPath, 'ghost')).resolves.toBeUndefined()
  })
})

describe('resolveWorkspaceDir', () => {
  it('resolves a registered name to its directory', async () => {
    const dir = await makeWorkspaceDir('demo')
    await registerWorkspace(registryPath, { name: 'demo', dir })

    expect(await resolveWorkspaceDir(registryPath, 'demo')).toBe(dir)
  })

  it('falls back to treating the input as a raw workspace directory', async () => {
    const dir = await makeWorkspaceDir('unregistered')

    expect(await resolveWorkspaceDir(registryPath, dir)).toBe(dir)
  })

  it('rejects an input that is neither a registered name nor a workspace directory', async () => {
    await expect(resolveWorkspaceDir(registryPath, 'nowhere')).rejects.toThrow(SporkError)
  })
})
