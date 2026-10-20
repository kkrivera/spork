import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/repo/scan.js', () => ({
  adoptLocalRepo: vi.fn(),
}))

const { adoptLocalRepo } = await import('../../src/repo/scan.js')
const { initWorkspace, initAndRegisterWorkspace, adoptRepoIntoWorkspace } = await import('../../src/workspace/workspace.js')
const { readManifest, manifestPath } = await import('../../src/workspace/manifest.js')
const { codeWorkspaceFilePath } = await import('../../src/workspace/codeWorkspace.js')
const { listWorkspaces } = await import('../../src/registry/registry.js')
const { localRepoRegistryPath } = await import('../../src/registry/repoRegistry.js')
const { SporkError } = await import('../../src/errors.js')

const adoptLocalRepoMock = vi.mocked(adoptLocalRepo)

let root: string
let dir: string
const ctx = { reposRoot: '', repoRegistryPath: '' }

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'spork-init-'))
  dir = path.join(root, 'demo')
  await mkdir(dir, { recursive: true })
  ctx.reposRoot = path.join(root, 'repos')
  ctx.repoRegistryPath = path.join(root, 'repos.json')
  adoptLocalRepoMock.mockReset()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('initWorkspace', () => {
  it('writes an initialized manifest + .code-workspace in place, with no repos yet', async () => {
    const handle = await initWorkspace(ctx, { name: 'demo', dir })

    expect(handle.manifest.origin).toBe('initialized')
    expect(handle.manifest.worktrees).toEqual([])
    expect(await readManifest(dir)).toEqual(handle.manifest)
    expect(existsSync(codeWorkspaceFilePath(dir, 'demo'))).toBe(true)
  })

  it('refuses when the folder is already a spork workspace', async () => {
    await initWorkspace(ctx, { name: 'demo', dir })

    await expect(initWorkspace(ctx, { name: 'demo-again', dir })).rejects.toThrow(SporkError)
  })
})

describe('initAndRegisterWorkspace', () => {
  it('inits and registers in one step', async () => {
    const registryPath = path.join(root, 'workspaces.json')

    const handle = await initAndRegisterWorkspace(ctx, registryPath, { name: 'demo', dir })

    expect(await listWorkspaces(registryPath)).toEqual([{ name: 'demo', dir }])
    expect(handle.manifest.origin).toBe('initialized')
  })

  it('rejects a duplicate name before touching the folder', async () => {
    const registryPath = path.join(root, 'workspaces.json')
    await initAndRegisterWorkspace(ctx, registryPath, { name: 'demo', dir })

    const otherDir = path.join(root, 'other')
    await mkdir(otherDir, { recursive: true })
    await expect(initAndRegisterWorkspace(ctx, registryPath, { name: 'demo', dir: otherDir })).rejects.toThrow(SporkError)
    expect(existsSync(manifestPath(otherDir))).toBe(false)
  })
})

describe('adoptRepoIntoWorkspace', () => {
  beforeEach(async () => {
    await initWorkspace(ctx, { name: 'demo', dir })
    await mkdir(path.join(dir, 'widgets'), { recursive: true })
  })

  it('adopts the folder (locally scoped) and appends an AdoptedEntry to the manifest', async () => {
    adoptLocalRepoMock.mockResolvedValue({ alias: 'widgets', source: 'git@github.com:acme/widgets.git', addedAt: '' })

    const entry = await adoptRepoIntoWorkspace(ctx, dir, 'widgets')

    expect(entry).toMatchObject({ kind: 'adopted', folder: 'widgets', source: 'git@github.com:acme/widgets.git' })
    expect(adoptLocalRepoMock).toHaveBeenCalledWith(
      { reposRoot: ctx.reposRoot, repoRegistryPath: localRepoRegistryPath(dir) },
      path.join(dir, 'widgets'),
    )
    expect((await readManifest(dir)).worktrees).toEqual([entry])
  })

  it('never sets requestedRef/localBranch — spork never asked git to check anything out here', async () => {
    adoptLocalRepoMock.mockResolvedValue({ alias: 'widgets', source: '/local/widgets', addedAt: '' })

    const entry = await adoptRepoIntoWorkspace(ctx, dir, 'widgets')

    expect(entry).not.toHaveProperty('requestedRef')
    expect(entry).not.toHaveProperty('localBranch')
  })

  it('does not lose a sibling entry when several folders are adopted concurrently', async () => {
    const folders = ['a', 'b', 'c', 'd']
    for (const folder of folders) await mkdir(path.join(dir, folder), { recursive: true })
    adoptLocalRepoMock.mockImplementation(async (_repoCtx, folderPath: string) => ({
      alias: path.basename(folderPath),
      source: `/local/${path.basename(folderPath)}`,
      addedAt: '',
    }))

    await Promise.all(folders.map((folder) => adoptRepoIntoWorkspace(ctx, dir, folder)))

    const manifest = await readManifest(dir)
    expect(manifest.worktrees).toHaveLength(4)
    expect(new Set(manifest.worktrees.map((wt) => wt.folder))).toEqual(new Set(folders))
  })
})
