import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/git/remote.js', () => ({ probeRemote: vi.fn() }))
vi.mock('../../src/ssh/keys.js', () => ({ findLockedKeys: vi.fn() }))
vi.mock('../../src/ssh/agent.js', () => ({ startTemporaryAgent: vi.fn() }))

const { probeRemote } = await import('../../src/git/remote.js')
const { findLockedKeys } = await import('../../src/ssh/keys.js')
const { startTemporaryAgent } = await import('../../src/ssh/agent.js')
const { prepareRemoteAccess } = await import('../../src/workspace/remoteAccess.js')
const { registerRepoAlias, localRepoRegistryPath } = await import('../../src/registry/repoRegistry.js')
const { resolveRepoCache } = await import('../../src/repo/cache.js')

const probeRemoteMock = vi.mocked(probeRemote)
const findLockedKeysMock = vi.mocked(findLockedKeys)
const startAgentMock = vi.mocked(startTemporaryAgent)

const WIDGETS = 'git@github.com:acme/widgets.git'
const GADGETS = 'git@github.com:acme/gadgets.git'
const WORK = 'git@github-work:corp/api.git'
const SOCKET = '/tmp/spork-agent-x/agent.sock'

let root: string
let dir: string
const ctx = { reposRoot: '', repoRegistryPath: '' }

/**
 * A fake world of remotes: `needs` maps a source to the key it needs (no
 * entry means the user's own agent already gets in); a probe through the
 * temporary agent succeeds once that key has been unlocked into it.
 */
function fakeRemotes(needs: Record<string, string>, options: { unlockable?: string[]; pushed?: string[] } = {}) {
  const loaded = new Set<string>()
  const agent = {
    socket: SOCKET,
    unlock: vi.fn(async (key: string) => {
      const ok = options.unlockable?.includes(key) ?? true
      if (ok) loaded.add(key)
      return ok
    }),
    stop: vi.fn(async () => {}),
  }
  startAgentMock.mockResolvedValue(agent)
  probeRemoteMock.mockImplementation(async (url, _branch, opts) => {
    const key = needs[url]
    const gotIn = key === undefined ? !opts?.sshAuthSock : opts?.sshAuthSock === SOCKET && loaded.has(key)
    if (!gotIn) return { status: 'auth-failed', hasBranch: false }
    return { status: 'ok', hasBranch: options.pushed?.includes(url) ?? false }
  })
  return agent
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'spork-access-'))
  dir = path.join(root, 'demo')
  ctx.reposRoot = path.join(root, 'repos')
  ctx.repoRegistryPath = path.join(root, 'repos.json')
  probeRemoteMock.mockReset()
  findLockedKeysMock.mockReset().mockResolvedValue([])
  startAgentMock.mockReset()
  // A registered alias only counts while its cache exists (the registry self-heals otherwise).
  const cachePath = resolveRepoCache(ctx.reposRoot, WIDGETS).path
  await mkdir(cachePath, { recursive: true })
  await writeFile(path.join(cachePath, 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('prepareRemoteAccess — checking each repo', () => {
  it("reports each repo's access and whether the workspace branch is already pushed", async () => {
    fakeRemotes({}, { pushed: [WIDGETS] })

    const { repos } = await prepareRemoteAccess(ctx, dir, [WIDGETS, GADGETS], 'me/demo')

    expect(repos).toEqual([
      { source: WIDGETS, status: 'ok', hasBranch: true },
      { source: GADGETS, status: 'ok', hasBranch: false },
    ])
    expect(probeRemoteMock).toHaveBeenCalledWith(WIDGETS, 'me/demo')
  })

  it('resolves a workspace-local or global alias to its source, keeping the alias as given', async () => {
    fakeRemotes({})
    await registerRepoAlias(localRepoRegistryPath(dir), { alias: 'widgets', source: WIDGETS, addedAt: '' })
    await registerRepoAlias(ctx.repoRegistryPath, { alias: 'w', source: WIDGETS, addedAt: '' })

    const { repos } = await prepareRemoteAccess(ctx, dir, ['widgets', 'w'], 'me/demo')

    expect(repos.map((repo) => repo.source)).toEqual(['widgets', 'w'])
    expect(probeRemoteMock.mock.calls.map((call) => call[0])).toEqual([WIDGETS, WIDGETS])
  })

  it('never asks or starts an agent without onUnlock, an SSH source, or an auth failure', async () => {
    fakeRemotes({ [WIDGETS]: '/k/id_rsa', 'https://github.com/acme/private.git': '/k/id_rsa' })
    const onUnlock = vi.fn()

    const silent = await prepareRemoteAccess(ctx, dir, [WIDGETS], 'me/demo')
    const https = await prepareRemoteAccess(ctx, dir, ['https://github.com/acme/private.git', GADGETS], 'me/demo', { onUnlock })

    expect(silent.repos[0]?.status).toBe('auth-failed')
    expect(https.repos.map((repo) => repo.status)).toEqual(['auth-failed', 'ok'])
    expect(onUnlock).not.toHaveBeenCalled()
    expect(startAgentMock).not.toHaveBeenCalled()
    await silent.close()
  })

  it('never asks on Windows', async () => {
    fakeRemotes({ [WIDGETS]: '/k/id_rsa' })
    const platform = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      const onUnlock = vi.fn()
      await prepareRemoteAccess(ctx, dir, [WIDGETS], 'me/demo', { onUnlock })
      expect(onUnlock).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'platform', platform)
    }
  })
})

describe('prepareRemoteAccess — unlocking keys', () => {
  it('asks once for a key that unlocks every repo on that host, and routes them through the temporary agent', async () => {
    const agent = fakeRemotes({ [WIDGETS]: '/k/id_rsa', [GADGETS]: '/k/id_rsa' }, { pushed: [GADGETS] })
    findLockedKeysMock.mockResolvedValue(['/k/id_rsa'])
    const onUnlock = vi.fn()

    const session = await prepareRemoteAccess(ctx, dir, [WIDGETS, GADGETS], 'me/demo', { onUnlock })

    expect(onUnlock).toHaveBeenCalledTimes(1)
    expect(onUnlock).toHaveBeenCalledWith({ keyPath: '/k/id_rsa', sources: [WIDGETS, GADGETS] })
    expect(findLockedKeysMock).toHaveBeenCalledWith({ host: 'github.com', user: 'git' })
    expect(session.repos).toEqual([
      { source: WIDGETS, status: 'ok', hasBranch: false, sshAuthSock: SOCKET },
      { source: GADGETS, status: 'ok', hasBranch: true, sshAuthSock: SOCKET },
    ])
    expect(agent.stop).not.toHaveBeenCalled()
    await session.close()
    expect(agent.stop).toHaveBeenCalled()
  })

  it("leaves a repo the user's own agent reaches on that agent", async () => {
    fakeRemotes({ [WIDGETS]: '/k/id_rsa' })
    findLockedKeysMock.mockResolvedValue(['/k/id_rsa'])

    const { repos } = await prepareRemoteAccess(ctx, dir, [WIDGETS, GADGETS], 'me/demo', { onUnlock: vi.fn() })

    expect(repos[0]?.sshAuthSock).toBe(SOCKET)
    expect(repos[1]).toEqual({ source: GADGETS, status: 'ok', hasBranch: false })
  })

  it('asks separately for each host that needs a different key', async () => {
    fakeRemotes({ [WIDGETS]: '/k/id_rsa', [WORK]: '/k/id_work' })
    findLockedKeysMock.mockImplementation(async (target) => (target.host === 'github-work' ? ['/k/id_work'] : ['/k/id_rsa']))
    const onUnlock = vi.fn()

    const { repos } = await prepareRemoteAccess(ctx, dir, [WIDGETS, WORK], 'me/demo', { onUnlock })

    expect(onUnlock.mock.calls.map((call) => call[0])).toEqual([
      { keyPath: '/k/id_rsa', sources: [WIDGETS] },
      { keyPath: '/k/id_work', sources: [WORK] },
    ])
    expect(repos.every((repo) => repo.status === 'ok')).toBe(true)
  })

})

describe('prepareRemoteAccess — when unlocking does not help', () => {
  it('moves on to the next key when one is skipped or does not get in, then gives up on that host', async () => {
    const agent = fakeRemotes({ [WIDGETS]: '/k/id_third' }, { unlockable: ['/k/id_second'] })
    findLockedKeysMock.mockResolvedValue(['/k/id_first', '/k/id_second'])
    const onUnlock = vi.fn()

    const session = await prepareRemoteAccess(ctx, dir, [WIDGETS], 'me/demo', { onUnlock })

    expect(onUnlock.mock.calls.map((call) => call[0].keyPath)).toEqual(['/k/id_first', '/k/id_second'])
    expect(agent.unlock).toHaveBeenCalledTimes(2)
    expect(session.repos[0]).toEqual({ source: WIDGETS, status: 'auth-failed', hasBranch: false })
    await session.close()
    expect(agent.stop).toHaveBeenCalled()
  })

  it('leaves the repos as they were if the temporary agent cannot start', async () => {
    fakeRemotes({ [WIDGETS]: '/k/id_rsa' })
    startAgentMock.mockRejectedValue(new Error("Couldn't start a temporary ssh-agent: spawn ssh-agent ENOENT"))
    findLockedKeysMock.mockResolvedValue(['/k/id_rsa'])
    const onUnlock = vi.fn()

    const session = await prepareRemoteAccess(ctx, dir, [WIDGETS], 'me/demo', { onUnlock })

    expect(onUnlock).not.toHaveBeenCalled()
    expect(session.repos[0]?.status).toBe('auth-failed')
    await expect(session.close()).resolves.toBeUndefined()
  })
})
