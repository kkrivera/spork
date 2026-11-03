import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  defaultAlias: (source: string) => source.replace(/^.*\/(.*)\.git$/, '$1'),
  prepareRemoteAccess: vi.fn(),
}))
vi.mock('@spork/prompts', () => ({
  confirm: vi.fn(),
  NotInteractiveError: class NotInteractiveError extends Error {},
}))

const { prepareRemoteAccess } = await import('@spork/core')
const { confirm } = await import('@spork/prompts')
const { keyUnlockNotifier, prepareWorkspaceRemotes } = await import('../../src/commands/workspace/workspaceRemotes.js')
const { createUi } = await import('../../src/output/color.js')
const { fakeRemoteAccess } = await import('./fakeRemoteAccess.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }), env: {} }
const WIDGETS = 'git@github.com:acme/widgets.git'
const GADGETS = 'git@github.com:acme/gadgets.git'

beforeEach(() => {
  vi.mocked(confirm).mockReset()
})

describe('prepareWorkspaceRemotes', () => {
  it('checks every repo once, passing on who to tell before a passphrase is asked for', async () => {
    vi.mocked(prepareRemoteAccess).mockReset().mockImplementation(fakeRemoteAccess({ sockets: { [WIDGETS]: '/tmp/agent.sock' } }))
    const onUnlockKey = vi.fn()

    const remotes = await prepareWorkspaceRemotes(ctx, '/ws/demo', 'demo', [WIDGETS, GADGETS], { onUnlockKey })

    expect(prepareRemoteAccess).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/repos.json' },
      '/ws/demo',
      [WIDGETS, GADGETS],
      'demo',
      { onUnlock: onUnlockKey },
    )
    expect([...remotes.sshAuthSocks]).toEqual([[WIDGETS, '/tmp/agent.sock']])
    expect(remotes.fetchRemoteBranch).toBe(false)
  })

  it('asks about an already-pushed branch only after the keys are settled', async () => {
    vi.mocked(prepareRemoteAccess).mockReset().mockImplementation(fakeRemoteAccess({ pushed: [GADGETS] }))
    vi.mocked(confirm).mockResolvedValue(true)

    const remotes = await prepareWorkspaceRemotes(ctx, '/ws/demo', 'demo', [WIDGETS, GADGETS], {})

    expect(remotes.fetchRemoteBranch).toBe(true)
    expect(vi.mocked(confirm).mock.calls[0]?.[0].message).toContain('for gadgets')
  })

  it('forgets any unlocked key if the pushed-branch question itself fails', async () => {
    const access = fakeRemoteAccess({ pushed: [WIDGETS] })
    vi.mocked(prepareRemoteAccess).mockReset().mockImplementation(access)
    vi.mocked(confirm).mockRejectedValue(new Error('stdin closed'))

    await expect(prepareWorkspaceRemotes(ctx, '/ws/demo', 'demo', [WIDGETS], {})).rejects.toThrow('stdin closed')
    expect(access.close).toHaveBeenCalledTimes(1)
  })
})

describe('keyUnlockNotifier', () => {
  const tty = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY }

  function setTty(stdin: boolean, stdout: boolean): void {
    Object.defineProperty(process.stdin, 'isTTY', { value: stdin, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: stdout, configurable: true })
  }

  afterEach(() => {
    setTty(tty.stdin, tty.stdout)
    vi.restoreAllMocks()
  })

  it('is undefined unless both stdin and stdout are a terminal, so nothing is ever asked in a script', () => {
    setTty(false, true)
    expect(keyUnlockNotifier(ctx)).toBeUndefined()
    setTty(true, false)
    expect(keyUnlockNotifier(ctx)).toBeUndefined()
  })

  it('says which repos need which key, and that spork will not keep it', () => {
    setTty(true, true)
    vi.spyOn(os, 'homedir').mockReturnValue('/Users/me')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    keyUnlockNotifier(ctx)?.({ keyPath: '/Users/me/.ssh/id_rsa', sources: [WIDGETS, GADGETS] })
    keyUnlockNotifier(ctx)?.({ keyPath: '/keys/work', sources: [WIDGETS] })

    const lines = logSpy.mock.calls.map((call) => call[0] as string)
    expect(lines[0]).toBe("widgets, gadgets need the SSH key ~/.ssh/id_rsa, which isn't loaded in your ssh-agent.")
    expect(lines[1]).toContain('only until this command finishes')
    expect(lines[1]).toContain('Press Enter with no passphrase to skip it')
    expect(lines[2]).toBe("widgets needs the SSH key /keys/work, which isn't loaded in your ssh-agent.")
  })
})
