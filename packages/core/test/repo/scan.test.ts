import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/git/remote.js', () => ({
  getRemoteUrl: vi.fn(),
}))
vi.mock('../../src/repo/repos.js', () => ({
  addRepoSource: vi.fn(),
}))

const { getRemoteUrl } = await import('../../src/git/remote.js')
const { addRepoSource } = await import('../../src/repo/repos.js')
const { findGitRepoDirs, scanAndAddRepos } = await import('../../src/repo/scan.js')

const getRemoteUrlMock = vi.mocked(getRemoteUrl)
const addRepoSourceMock = vi.mocked(addRepoSource)

let scanDir: string

beforeEach(async () => {
  scanDir = await mkdtemp(path.join(os.tmpdir(), 'spork-scan-'))
  getRemoteUrlMock.mockReset().mockResolvedValue(null)
  addRepoSourceMock.mockReset()
})

afterEach(async () => {
  await rm(scanDir, { recursive: true, force: true })
})

async function makeRepoDir(name: string): Promise<string> {
  const dir = path.join(scanDir, name)
  await mkdir(path.join(dir, '.git'), { recursive: true })
  return dir
}

describe('findGitRepoDirs', () => {
  it('finds immediate subdirectories that contain a .git entry', async () => {
    const widgets = await makeRepoDir('widgets')
    await mkdir(path.join(scanDir, 'not-a-repo'), { recursive: true })

    const dirs = await findGitRepoDirs(scanDir)

    expect(dirs).toEqual([widgets])
  })

  it('treats a .git file (linked worktree) as a repo too', async () => {
    const dir = path.join(scanDir, 'gadgets')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, '.git'), 'gitdir: /somewhere/else\n', 'utf8')

    const dirs = await findGitRepoDirs(scanDir)

    expect(dirs).toEqual([dir])
  })

  it('does not descend into subdirectories', async () => {
    await mkdir(path.join(scanDir, 'nested', 'widgets', '.git'), { recursive: true })

    const dirs = await findGitRepoDirs(scanDir)

    expect(dirs).toEqual([])
  })

  it('ignores plain files at the top level', async () => {
    await writeFile(path.join(scanDir, 'README.md'), 'hi\n', 'utf8')

    const dirs = await findGitRepoDirs(scanDir)

    expect(dirs).toEqual([])
  })
})

describe('scanAndAddRepos', () => {
  const ctx = { reposRoot: '/repos', repoRegistryPath: '/registry.json' }

  it('adds a repo with a remote, using the remote url as identity and correcting origin', async () => {
    const widgets = await makeRepoDir('widgets')
    getRemoteUrlMock.mockResolvedValue('git@github.com:acme/widgets.git')
    addRepoSourceMock.mockResolvedValue({ alias: 'widgets', source: 'git@github.com:acme/widgets.git', addedAt: '' })

    const result = await scanAndAddRepos(ctx, scanDir)

    expect(addRepoSourceMock).toHaveBeenCalledWith(ctx, 'git@github.com:acme/widgets.git', {
      cloneFrom: widgets,
      correctOriginTo: 'git@github.com:acme/widgets.git',
    })
    expect(result.added).toEqual([{ alias: 'widgets', source: 'git@github.com:acme/widgets.git', addedAt: '' }])
    expect(result.skipped).toEqual([])
  })

  it('falls back to the local path as identity when there is no remote', async () => {
    const gadgets = await makeRepoDir('gadgets')
    getRemoteUrlMock.mockResolvedValue(null)
    addRepoSourceMock.mockResolvedValue({ alias: 'gadgets', source: gadgets, addedAt: '' })

    await scanAndAddRepos(ctx, scanDir)

    expect(addRepoSourceMock).toHaveBeenCalledWith(ctx, gadgets, { cloneFrom: gadgets, correctOriginTo: undefined })
  })

  it('skips a repo that fails to add and continues with the rest', async () => {
    await makeRepoDir('broken')
    await makeRepoDir('widgets')
    getRemoteUrlMock.mockResolvedValue(null)
    addRepoSourceMock.mockImplementation(async (_ctx, source: string) => {
      if (source.includes('broken')) throw new Error('clone failed')
      return { alias: 'widgets', source, addedAt: '' }
    })

    const result = await scanAndAddRepos(ctx, scanDir)

    expect(result.added).toHaveLength(1)
    expect(result.skipped).toEqual([{ path: path.join(scanDir, 'broken'), reason: 'clone failed' }])
  })

  it('stringifies a non-Error rejection as the skip reason', async () => {
    const broken = await makeRepoDir('broken')
    getRemoteUrlMock.mockResolvedValue(null)
    addRepoSourceMock.mockRejectedValue('not an Error instance')

    const result = await scanAndAddRepos(ctx, scanDir)

    expect(result.skipped).toEqual([{ path: broken, reason: 'not an Error instance' }])
  })
})
