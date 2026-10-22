import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
vi.mock('../../src/git/submodule.js', () => ({
  hasSubmodules: vi.fn(),
  initSubmodules: vi.fn(),
}))

const { addWorktree } = await import('../../src/git/worktree.js')
const { GitCommandError } = await import('../../src/git/exec.js')
const { hasSubmodules, initSubmodules } = await import('../../src/git/submodule.js')
const { ensureRepoCache, resolveRepoCache } = await import('../../src/repo/cache.js')
const { createWorkspace, addRepo } = await import('../../src/workspace/workspace.js')
const { readManifest } = await import('../../src/workspace/manifest.js')
const { registerRepoAlias, localRepoRegistryPath } = await import('../../src/registry/repoRegistry.js')
const { SporkError } = await import('../../src/errors.js')
const { fakeAddWorktree } = await import('./fakeAddWorktree.js')

const addWorktreeMock = vi.mocked(addWorktree)
const ensureRepoCacheMock = vi.mocked(ensureRepoCache)
const hasSubmodulesMock = vi.mocked(hasSubmodules)
const initSubmodulesMock = vi.mocked(initSubmodules)
const WIDGETS_SOURCE = 'git@github.com:acme/widgets.git'

let root: string
let dir: string
const ctx = { reposRoot: '', repoRegistryPath: '' }

function widgetsCachePath(): string {
  return resolveRepoCache(ctx.reposRoot, WIDGETS_SOURCE).path
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'spork-addrepo-'))
  dir = path.join(root, 'demo')
  ctx.reposRoot = path.join(root, 'repos')
  ctx.repoRegistryPath = path.join(root, 'repos.json')
  await createWorkspace(ctx, { name: 'demo', dir })
  addWorktreeMock.mockReset().mockImplementation(fakeAddWorktree)
  ensureRepoCacheMock.mockReset().mockResolvedValue({ id: 'widgets-abc', source: '', path: '/unused' })
  hasSubmodulesMock.mockReset().mockReturnValue(false)
  initSubmodulesMock.mockReset().mockResolvedValue(undefined)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('addRepo', () => {
  it('adds a worktree on the workspace\'s own branch and records it in the manifest', async () => {
    const { entry, submodulesInitialized, reusedExistingBranch } = await addRepo(ctx, dir, { source: WIDGETS_SOURCE })

    expect(entry).toMatchObject({
      folder: 'widgets',
      source: WIDGETS_SOURCE,
      requestedRef: 'HEAD',
      localBranch: 'demo',
    })
    expect(submodulesInitialized).toBe(false)
    expect(reusedExistingBranch).toBe(false)
    expect(addWorktreeMock).toHaveBeenCalledWith(widgetsCachePath(), path.join(dir, 'widgets'), 'demo', 'HEAD')
    expect(ensureRepoCacheMock).toHaveBeenCalledWith(ctx.reposRoot, WIDGETS_SOURCE, {})
    expect((await readManifest(dir)).worktrees).toEqual([entry])
  })

  it('uses the requested ref as the worktree start point', async () => {
    await addRepo(ctx, dir, { source: WIDGETS_SOURCE, ref: 'release/2.0' })

    expect(addWorktreeMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 'release/2.0')
  })

  it('honors an explicit --as folder name, without changing the (workspace-wide) branch', async () => {
    const { entry } = await addRepo(ctx, dir, { source: WIDGETS_SOURCE, folder: 'widgets-v2' })

    expect(entry.folder).toBe('widgets-v2')
    expect(entry.localBranch).toBe('demo')
  })

  it('rejects a second worktree with the same folder name', async () => {
    await addRepo(ctx, dir, { source: WIDGETS_SOURCE })
    addWorktreeMock.mockClear()

    await expect(addRepo(ctx, dir, { source: 'git@github.com:other/widgets.git' })).rejects.toThrow(SporkError)
    expect(addWorktreeMock).not.toHaveBeenCalled()
  })

  it('rejects adding the same repo twice, even under a different folder name', async () => {
    await addRepo(ctx, dir, { source: WIDGETS_SOURCE, ref: 'main', folder: 'widgets-a' })
    addWorktreeMock.mockClear()

    await expect(
      addRepo(ctx, dir, { source: WIDGETS_SOURCE, ref: 'main', folder: 'widgets-b' }),
    ).rejects.toThrow(SporkError)
    expect(addWorktreeMock).not.toHaveBeenCalled()
  })

  it('gives every different repo in the workspace the identical branch name', async () => {
    const gadgetsSource = 'git@github.com:acme/gadgets.git'

    const { entry: widgetsEntry } = await addRepo(ctx, dir, { source: WIDGETS_SOURCE })
    const { entry: gadgetsEntry } = await addRepo(ctx, dir, { source: gadgetsSource })

    expect(widgetsEntry.localBranch).toBe('demo')
    expect(gadgetsEntry.localBranch).toBe('demo')
  })
})

describe('addRepo — branch naming', () => {
  it('uses the workspace name verbatim as the branch, including a "/" it contains (not slugified)', async () => {
    const ticketDir = path.join(root, 'krisrivera', 'gw-2-fix')
    await createWorkspace(ctx, { name: 'krisrivera/gw-2-fix', dir: ticketDir })

    const { entry } = await addRepo(ctx, ticketDir, { source: WIDGETS_SOURCE })

    expect(entry.localBranch).toBe('krisrivera/gw-2-fix')
    expect(addWorktreeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'krisrivera/gw-2-fix',
      expect.anything(),
    )
  })

  it('reports reusedExistingBranch when addWorktree checked out an existing branch instead of creating one', async () => {
    addWorktreeMock.mockResolvedValue({ reusedExistingBranch: true })

    const { reusedExistingBranch } = await addRepo(ctx, dir, { source: WIDGETS_SOURCE })

    expect(reusedExistingBranch).toBe(true)
  })
})

describe('addRepo — branch collisions', () => {
  it('surfaces a clear error when the target branch is already checked out elsewhere', async () => {
    addWorktreeMock.mockRejectedValue(
      new GitCommandError(['worktree', 'add'], "fatal: 'demo' is already checked out at '/other/path'\n"),
    )

    const error: unknown = await addRepo(ctx, dir, { source: WIDGETS_SOURCE }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SporkError)
    expect((error as Error).message).toMatch(/already checked out elsewhere/)
    expect((error as Error).message).toMatch(/create this workspace under a different name/)
  })

  it('also catches a "branch already exists" failure as a defensive fallback (addWorktree normally avoids this by checking first)', async () => {
    addWorktreeMock.mockRejectedValue(
      new GitCommandError(['worktree', 'add'], "fatal: a branch named 'demo' already exists\n"),
    )

    await expect(addRepo(ctx, dir, { source: WIDGETS_SOURCE })).rejects.toThrow(SporkError)
  })

  it('re-throws an unrelated addWorktree failure unchanged', async () => {
    addWorktreeMock.mockRejectedValue(new Error('disk full'))

    await expect(addRepo(ctx, dir, { source: WIDGETS_SOURCE })).rejects.toThrow('disk full')
  })
})

describe('addRepo — submodules', () => {
  it('initializes submodules when the worktree has a .gitmodules file', async () => {
    hasSubmodulesMock.mockReturnValue(true)

    const { entry, submodulesInitialized, submoduleWarning } = await addRepo(ctx, dir, { source: WIDGETS_SOURCE })

    expect(submodulesInitialized).toBe(true)
    expect(submoduleWarning).toBeUndefined()
    expect(hasSubmodulesMock).toHaveBeenCalledWith(path.join(dir, 'widgets'))
    expect(initSubmodulesMock).toHaveBeenCalledWith(path.join(dir, 'widgets'))
    // The worktree is still registered even though this test doesn't exercise a failure.
    expect((await readManifest(dir)).worktrees).toEqual([entry])
  })

  it('still registers the worktree, with a warning, when submodule init fails', async () => {
    hasSubmodulesMock.mockReturnValue(true)
    initSubmodulesMock.mockRejectedValue(new Error('fatal: could not read Username for private-submodule-host'))

    const { entry, submodulesInitialized, submoduleWarning } = await addRepo(ctx, dir, { source: WIDGETS_SOURCE })

    expect(submodulesInitialized).toBe(false)
    expect(submoduleWarning).toContain('private-submodule-host')
    expect((await readManifest(dir)).worktrees).toEqual([entry])
  })
})

describe('addRepo — aliases', () => {
  it('resolves a registered alias to its real source and stores the resolved source, not the alias', async () => {
    const cachePath = resolveRepoCache(ctx.reposRoot, WIDGETS_SOURCE).path
    await mkdir(cachePath, { recursive: true })
    await writeFile(path.join(cachePath, 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
    await registerRepoAlias(ctx.repoRegistryPath, { alias: 'widgets-alias', source: WIDGETS_SOURCE, addedAt: '' })

    const { entry } = await addRepo(ctx, dir, { source: 'widgets-alias' })

    expect(entry.source).toBe(WIDGETS_SOURCE)
    expect(entry.folder).toBe('widgets')
    expect(addWorktreeMock).toHaveBeenCalledWith(widgetsCachePath(), path.join(dir, 'widgets'), 'demo', 'HEAD')
  })
})

describe('addRepo — local vs. global alias registration', () => {
  it('registers the alias locally to the workspace by default, never touching the global file', async () => {
    const { aliasScope } = await addRepo(ctx, dir, { source: WIDGETS_SOURCE })

    expect(aliasScope).toBe('local')
    const localFile = JSON.parse(await readFile(localRepoRegistryPath(dir), 'utf8'))
    expect(localFile.repos).toEqual([expect.objectContaining({ alias: 'widgets', source: WIDGETS_SOURCE })])
    expect(existsSync(ctx.repoRegistryPath)).toBe(false)
  })

  it('registers globally instead when --global is passed, never touching the local file', async () => {
    const { aliasScope } = await addRepo(ctx, dir, { source: WIDGETS_SOURCE, global: true })

    expect(aliasScope).toBe('global')
    const globalFile = JSON.parse(await readFile(ctx.repoRegistryPath, 'utf8'))
    expect(globalFile.repos).toEqual([expect.objectContaining({ alias: 'widgets', source: WIDGETS_SOURCE })])
    expect(existsSync(localRepoRegistryPath(dir))).toBe(false)
  })

  it('lets two different workspaces give the same alias name different meanings', async () => {
    const otherDir = path.join(root, 'other-workspace')
    await createWorkspace(ctx, { name: 'other', dir: otherDir })
    const otherSource = 'git@github.com:acme/gadgets.git'

    for (const source of [WIDGETS_SOURCE, otherSource]) {
      const cachePath = resolveRepoCache(ctx.reposRoot, source).path
      await mkdir(cachePath, { recursive: true })
      await writeFile(path.join(cachePath, 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
    }

    await registerRepoAlias(localRepoRegistryPath(dir), { alias: 'shared-name', source: WIDGETS_SOURCE, addedAt: '' })
    await registerRepoAlias(localRepoRegistryPath(otherDir), { alias: 'shared-name', source: otherSource, addedAt: '' })

    const fromDemo = await addRepo(ctx, dir, { source: 'shared-name', folder: 'from-demo' })
    const fromOther = await addRepo(ctx, otherDir, { source: 'shared-name', folder: 'from-other' })

    expect(fromDemo.entry.source).toBe(WIDGETS_SOURCE)
    expect(fromOther.entry.source).toBe(otherSource)
  })
})

describe('addRepo — concurrency', () => {
  it('does not lose a sibling entry when several --repo adds run concurrently (the task-runner path)', async () => {
    const sources = Array.from({ length: 8 }, (_, i) => `git@github.com:acme/repo-${i}.git`)

    const results = await Promise.all(sources.map((source) => addRepo(ctx, dir, { source })))

    const manifest = await readManifest(dir)
    expect(manifest.worktrees).toHaveLength(8)
    expect(new Set(manifest.worktrees.map((wt) => wt.source))).toEqual(new Set(sources))
    expect(new Set(results.map((r) => r.entry.folder))).toEqual(new Set(manifest.worktrees.map((wt) => wt.folder)))
  })

  it('keeps the .code-workspace file in sync with every concurrently-added repo', async () => {
    const sources = Array.from({ length: 6 }, (_, i) => `git@github.com:acme/repo-${i}.git`)

    await Promise.all(sources.map((source) => addRepo(ctx, dir, { source })))

    const manifest = await readManifest(dir)
    const codeWorkspace = JSON.parse(await readFile(path.join(dir, 'demo.code-workspace'), 'utf8'))
    const codeWorkspaceFolders = codeWorkspace.folders.map((f: { path: string }) => f.path)
    expect(new Set(codeWorkspaceFolders)).toEqual(new Set(manifest.worktrees.map((wt) => `./${wt.folder}`)))
    expect(codeWorkspaceFolders).toHaveLength(6)
  })
})
