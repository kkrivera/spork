import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RepoRemoteAccess } from '@spork/core'

vi.mock('@spork/core', () => ({
  defaultAlias: (source: string) => source,
}))
vi.mock('@spork/prompts', () => ({
  confirm: vi.fn(),
  NotInteractiveError: class NotInteractiveError extends Error {},
}))

const { confirm, NotInteractiveError } = await import('@spork/prompts')
const { resolveFetchRemoteBranch } = await import('../../src/commands/workspace/remoteBranchPrompt.js')

function repos(...pushed: boolean[]): RepoRemoteAccess[] {
  const names = ['app', 'connector', 'infra']
  return pushed.map((hasBranch, index) => ({ source: names[index] as string, status: 'ok', hasBranch, conflicts: [] }))
}

beforeEach(() => {
  vi.mocked(confirm).mockReset()
})

describe('resolveFetchRemoteBranch', () => {
  it('uses an explicit flag as-is, without asking', async () => {
    expect(await resolveFetchRemoteBranch(repos(true), 'demo', true)).toEqual({ fetchRemoteBranch: true })
    expect(await resolveFetchRemoteBranch(repos(true), 'demo', false)).toEqual({ fetchRemoteBranch: false })
    expect(confirm).not.toHaveBeenCalled()
  })

  it("doesn't prompt when no remote has the branch, or there are no repos", async () => {
    expect(await resolveFetchRemoteBranch(repos(false, false), 'demo', undefined)).toEqual({ fetchRemoteBranch: false })
    expect(await resolveFetchRemoteBranch([], 'demo', undefined)).toEqual({ fetchRemoteBranch: false })
    expect(confirm).not.toHaveBeenCalled()
  })

  it('asks once, naming only the repos whose remote has the branch', async () => {
    vi.mocked(confirm).mockResolvedValue(true)

    const decision = await resolveFetchRemoteBranch(repos(true, false, true), 'me/demo', undefined)

    expect(decision).toEqual({ fetchRemoteBranch: true })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledWith({
      message: 'Branch "me/demo" already exists on the remote for app, infra. Start from the remote branch?',
    })
  })

  it('starts fresh when the user declines (or presses Esc)', async () => {
    vi.mocked(confirm).mockResolvedValue(false)

    expect(await resolveFetchRemoteBranch(repos(true), 'demo', undefined)).toEqual({ fetchRemoteBranch: false })
  })

  it('starts fresh and returns a notice when there is no TTY to ask', async () => {
    vi.mocked(confirm).mockRejectedValue(new NotInteractiveError())

    expect(await resolveFetchRemoteBranch(repos(true), 'demo', undefined)).toEqual({
      fetchRemoteBranch: false,
      notice: 'Branch "demo" already exists on the remote for app; pass --from-remote-branch to start from it.',
    })
  })

  it('re-throws a real prompt failure', async () => {
    vi.mocked(confirm).mockRejectedValue(new Error('stdin closed'))

    await expect(resolveFetchRemoteBranch(repos(true), 'demo', undefined)).rejects.toThrow('stdin closed')
  })
})
