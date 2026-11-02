import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/git/remote.js', () => ({
  remoteHasBranch: vi.fn(),
}))

const { remoteHasBranch } = await import('../../src/git/remote.js')
const { remoteHasWorkspaceBranch } = await import('../../src/workspace/workspaceBranch.js')
const { registerRepoAlias, localRepoRegistryPath } = await import('../../src/registry/repoRegistry.js')
const { resolveRepoCache } = await import('../../src/repo/cache.js')

const remoteHasBranchMock = vi.mocked(remoteHasBranch)
const WIDGETS_SOURCE = 'git@github.com:acme/widgets.git'

let root: string
const ctx = { reposRoot: '', repoRegistryPath: '' }

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'spork-wsbranch-'))
  ctx.reposRoot = path.join(root, 'repos')
  ctx.repoRegistryPath = path.join(root, 'repos.json')
  remoteHasBranchMock.mockReset().mockResolvedValue(true)
  // A registered alias only counts while its cache exists (the registry self-heals otherwise).
  const cachePath = resolveRepoCache(ctx.reposRoot, WIDGETS_SOURCE).path
  await mkdir(cachePath, { recursive: true })
  await writeFile(path.join(cachePath, 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('remoteHasWorkspaceBranch', () => {
  it('asks the raw source directly when it is not an alias', async () => {
    expect(await remoteHasWorkspaceBranch(ctx, path.join(root, 'demo'), WIDGETS_SOURCE, 'me/demo')).toBe(true)

    expect(remoteHasBranchMock).toHaveBeenCalledWith(WIDGETS_SOURCE, 'me/demo')
  })

  it("resolves a workspace-local alias to its source first", async () => {
    const dir = path.join(root, 'demo')
    await registerRepoAlias(localRepoRegistryPath(dir), { alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' })

    await remoteHasWorkspaceBranch(ctx, dir, 'widgets', 'me/demo')

    expect(remoteHasBranchMock).toHaveBeenCalledWith(WIDGETS_SOURCE, 'me/demo')
  })

  it('resolves a global alias when the workspace has no local registry yet', async () => {
    await registerRepoAlias(ctx.repoRegistryPath, { alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' })

    await remoteHasWorkspaceBranch(ctx, path.join(root, 'not-created-yet'), 'widgets', 'me/demo')

    expect(remoteHasBranchMock).toHaveBeenCalledWith(WIDGETS_SOURCE, 'me/demo')
  })
})
