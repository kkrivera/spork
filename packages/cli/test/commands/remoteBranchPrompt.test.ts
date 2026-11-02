import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  defaultAlias: (source: string) => source,
  remoteHasWorkspaceBranch: vi.fn(),
}))
vi.mock('@spork/prompts', () => ({
  confirm: vi.fn(),
  NotInteractiveError: class NotInteractiveError extends Error {},
}))

const { remoteHasWorkspaceBranch } = await import('@spork/core')
const { confirm, NotInteractiveError } = await import('@spork/prompts')
const { resolveFetchRemoteBranch } = await import('../../src/commands/workspace/remoteBranchPrompt.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }), env: {} }

beforeEach(() => {
  vi.mocked(remoteHasWorkspaceBranch).mockReset().mockResolvedValue(false)
  vi.mocked(confirm).mockReset()
})

describe('resolveFetchRemoteBranch', () => {
  it('uses an explicit flag as-is, without checking any remote', async () => {
    expect(await resolveFetchRemoteBranch(ctx, '/ws/demo', 'demo', ['app'], true)).toEqual({ fetchRemoteBranch: true })
    expect(await resolveFetchRemoteBranch(ctx, '/ws/demo', 'demo', ['app'], false)).toEqual({ fetchRemoteBranch: false })
    expect(remoteHasWorkspaceBranch).not.toHaveBeenCalled()
  })

  it('has nothing to check for an empty batch', async () => {
    expect(await resolveFetchRemoteBranch(ctx, '/ws/demo', 'demo', [], undefined)).toEqual({ fetchRemoteBranch: false })
    expect(remoteHasWorkspaceBranch).not.toHaveBeenCalled()
  })

  it("doesn't prompt when no remote has the branch", async () => {
    expect(await resolveFetchRemoteBranch(ctx, '/ws/demo', 'demo', ['app', 'connector'], undefined)).toEqual({ fetchRemoteBranch: false })
    expect(remoteHasWorkspaceBranch).toHaveBeenCalledTimes(2)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('asks once, naming only the repos whose remote has the branch', async () => {
    vi.mocked(remoteHasWorkspaceBranch).mockImplementation(async (_ctx, _dir, source) => source !== 'connector')
    vi.mocked(confirm).mockResolvedValue(true)

    const decision = await resolveFetchRemoteBranch(ctx, '/ws/demo', 'me/demo', ['app', 'connector', 'infra'], undefined)

    expect(decision).toEqual({ fetchRemoteBranch: true })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledWith({
      message: 'Branch "me/demo" already exists on the remote for app, infra. Start from the remote branch?',
    })
  })

  it('starts fresh when the user declines (or presses Esc)', async () => {
    vi.mocked(remoteHasWorkspaceBranch).mockResolvedValue(true)
    vi.mocked(confirm).mockResolvedValue(false)

    expect(await resolveFetchRemoteBranch(ctx, '/ws/demo', 'demo', ['app'], undefined)).toEqual({ fetchRemoteBranch: false })
  })

  it('starts fresh and returns a notice when there is no TTY to ask', async () => {
    vi.mocked(remoteHasWorkspaceBranch).mockResolvedValue(true)
    vi.mocked(confirm).mockRejectedValue(new NotInteractiveError())

    expect(await resolveFetchRemoteBranch(ctx, '/ws/demo', 'demo', ['app'], undefined)).toEqual({
      fetchRemoteBranch: false,
      notice: 'Branch "demo" already exists on the remote for app; pass --from-remote-branch to start from it.',
    })
  })

  it('re-throws a real prompt failure', async () => {
    vi.mocked(remoteHasWorkspaceBranch).mockResolvedValue(true)
    vi.mocked(confirm).mockRejectedValue(new Error('stdin closed'))

    await expect(resolveFetchRemoteBranch(ctx, '/ws/demo', 'demo', ['app'], undefined)).rejects.toThrow('stdin closed')
  })
})
