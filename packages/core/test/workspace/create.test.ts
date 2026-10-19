import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAndRegisterWorkspace, createWorkspace } from '../../src/workspace/workspace.js'
import { readManifest } from '../../src/workspace/manifest.js'
import { codeWorkspaceFilePath } from '../../src/workspace/codeWorkspace.js'
import { listWorkspaces } from '../../src/registry/registry.js'
import { SporkError } from '../../src/errors.js'
import { existsSync } from 'node:fs'

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'spork-workspace-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('createWorkspace', () => {
  it('creates the workspace dir, an empty manifest, and a .code-workspace file', async () => {
    const dir = path.join(root, 'demo')

    const handle = await createWorkspace(
      { reposRoot: path.join(root, 'repos'), repoRegistryPath: path.join(root, 'repos.json') },
      { name: 'demo', dir },
    )

    expect(handle).toEqual({ name: 'demo', dir, manifest: expect.objectContaining({ name: 'demo', worktrees: [] }) })
    expect(await readManifest(dir)).toEqual(handle.manifest)
    expect(existsSync(codeWorkspaceFilePath(dir, 'demo'))).toBe(true)
  })
})

describe('createAndRegisterWorkspace', () => {
  it('creates the workspace and registers it in one step', async () => {
    const dir = path.join(root, 'demo')
    const registryPath = path.join(root, 'workspaces.json')

    const handle = await createAndRegisterWorkspace(
      { reposRoot: path.join(root, 'repos'), repoRegistryPath: path.join(root, 'repos.json') },
      registryPath,
      { name: 'demo', dir },
    )

    expect(handle.name).toBe('demo')
    expect(await readManifest(dir)).toEqual(handle.manifest)
    expect(await listWorkspaces(registryPath)).toEqual([{ name: 'demo', dir }])
  })

  it('rejects a duplicate name before creating anything on disk', async () => {
    const registryPath = path.join(root, 'workspaces.json')
    const ctx = { reposRoot: path.join(root, 'repos'), repoRegistryPath: path.join(root, 'repos.json') }
    await createAndRegisterWorkspace(ctx, registryPath, { name: 'demo', dir: path.join(root, 'demo') })

    const secondDir = path.join(root, 'demo-again')
    await expect(createAndRegisterWorkspace(ctx, registryPath, { name: 'demo', dir: secondDir })).rejects.toThrow(SporkError)

    expect(existsSync(secondDir)).toBe(false)
  })
})
