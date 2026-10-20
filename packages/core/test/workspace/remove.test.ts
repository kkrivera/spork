import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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
vi.mock('../../src/git/worktree.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/git/worktree.js')>('../../src/git/worktree.js')
  return { ...actual, addWorktree: vi.fn(), removeWorktree: vi.fn(), pruneWorktrees: vi.fn() }
})

const { addWorktree, removeWorktree } = await import('../../src/git/worktree.js')
const { ensureRepoCache } = await import('../../src/repo/cache.js')
const { createWorkspace, initWorkspace, addRepo, removeWorkspace, removeAndUnregisterWorkspace } = await import(
  '../../src/workspace/workspace.js'
)
const { manifestPath, readManifest, writeManifest } = await import('../../src/workspace/manifest.js')
const { codeWorkspaceFilePath } = await import('../../src/workspace/codeWorkspace.js')
const { registerWorkspace, listWorkspaces } = await import('../../src/registry/registry.js')
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

describe('removeWorkspace — an initialized (workspace init) workspace', () => {
  it('deletes only the manifest + .code-workspace files, never the directory or any folder inside it, even a mix of adopted and real worktree entries', async () => {
    const initDir = path.join(root, 'in-place')
    await mkdir(path.join(initDir, 'adopted-repo'), { recursive: true })
    await initWorkspace(ctx, { name: 'in-place', dir: initDir })
    await addRepo(ctx, initDir, { source: 'git@github.com:acme/gadgets.git' })
    const manifest = await readManifest(initDir)
    manifest.worktrees.push({ kind: 'adopted', folder: 'adopted-repo', source: '/local/adopted-repo', addedAt: '' })
    await writeManifest(initDir, manifest)
    vi.mocked(removeWorktree).mockClear()

    await removeWorkspace(ctx, initDir)

    expect(removeWorktree).toHaveBeenCalledTimes(1) // only the real worktree entry
    expect(existsSync(initDir)).toBe(true)
    expect(existsSync(path.join(initDir, 'adopted-repo'))).toBe(true)
    expect(existsSync(manifestPath(initDir))).toBe(false)
    expect(existsSync(codeWorkspaceFilePath(initDir, 'in-place'))).toBe(false)
  })
})

describe('removeAndUnregisterWorkspace', () => {
  it('removes the workspace and drops its matching registry entry', async () => {
    const registryPath = path.join(root, 'workspaces.json')
    await registerWorkspace(registryPath, { name: 'demo', dir })

    await removeAndUnregisterWorkspace(ctx, registryPath, dir)

    expect(existsSync(dir)).toBe(false)
    expect(await listWorkspaces(registryPath)).toEqual([])
  })

  it('does not try to unregister when nothing in the registry matches the resolved dir', async () => {
    const registryPath = path.join(root, 'workspaces.json')
    const unrelatedDir = path.join(root, 'elsewhere')
    await createWorkspace(ctx, { name: 'unrelated', dir: unrelatedDir })
    await registerWorkspace(registryPath, { name: 'unrelated', dir: unrelatedDir })

    await removeAndUnregisterWorkspace(ctx, registryPath, dir)

    expect(await listWorkspaces(registryPath)).toEqual([{ name: 'unrelated', dir: unrelatedDir }])
  })
})
