import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../src/git/exec.js', () => ({
  execGit: vi.fn(),
}))

const { execGit } = await import('../../src/git/exec.js')
const { cloneBare, fetchAll, resolveRef, setHeadBranch } = await import('../../src/git/clone.js')

const execGitMock = vi.mocked(execGit)

beforeEach(() => {
  execGitMock.mockReset()
})

describe('cloneBare', () => {
  it('clones the remote as a bare repo', async () => {
    execGitMock.mockResolvedValue({ stdout: '', stderr: '' })

    await cloneBare('git@example.com:foo/bar.git', '/cache/foo-bar')

    expect(execGitMock).toHaveBeenCalledWith(['clone', '--bare', 'git@example.com:foo/bar.git', '/cache/foo-bar'])
  })
})

describe('fetchAll', () => {
  it('fetches all branches and tags in the bare cache', async () => {
    execGitMock.mockResolvedValue({ stdout: '', stderr: '' })

    await fetchAll('/cache/foo-bar')

    expect(execGitMock).toHaveBeenCalledWith(['fetch', '--all', '--tags'], { cwd: '/cache/foo-bar' })
  })

  it('configures the fetch refspec before fetching, so refs/heads/* actually refreshes (git clone --bare sets none by default)', async () => {
    execGitMock.mockResolvedValue({ stdout: '', stderr: '' })

    await fetchAll('/cache/foo-bar')

    expect(execGitMock).toHaveBeenCalledWith(
      ['config', 'remote.origin.fetch', '+refs/heads/*:refs/heads/*'],
      { cwd: '/cache/foo-bar' },
    )
    const configCallOrder = execGitMock.mock.calls.findIndex((call) => call[0][0] === 'config')
    const fetchCallOrder = execGitMock.mock.calls.findIndex((call) => call[0][0] === 'fetch')
    expect(configCallOrder).toBeLessThan(fetchCallOrder)
  })

  it('never passes --prune, which would delete local-only spork-owned branches missing from the remote', async () => {
    execGitMock.mockResolvedValue({ stdout: '', stderr: '' })

    await fetchAll('/cache/foo-bar')

    const fetchCall = execGitMock.mock.calls.find((call) => call[0][0] === 'fetch')
    expect(fetchCall?.[0]).not.toContain('--prune')
  })
})

describe('resolveRef', () => {
  it('resolves a ref to a trimmed commit sha', async () => {
    execGitMock.mockResolvedValue({ stdout: 'abc123\n', stderr: '' })

    const sha = await resolveRef('/cache/foo-bar', 'main')

    expect(sha).toBe('abc123')
    expect(execGitMock).toHaveBeenCalledWith(['rev-parse', '--verify', 'main^{commit}'], { cwd: '/cache/foo-bar' })
  })
})

describe('setHeadBranch', () => {
  it('repoints the bare cache HEAD at the given branch', async () => {
    execGitMock.mockResolvedValue({ stdout: '', stderr: '' })

    await setHeadBranch('/cache/foo-bar', 'trunk')

    expect(execGitMock).toHaveBeenCalledWith(['symbolic-ref', 'HEAD', 'refs/heads/trunk'], { cwd: '/cache/foo-bar' })
  })
})
