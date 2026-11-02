import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../src/git/exec.js', () => ({
  execGit: vi.fn(),
}))

const { execGit } = await import('../../src/git/exec.js')
const { cloneBare, resolveRef, setHeadBranch } = await import('../../src/git/clone.js')

const execGitMock = vi.mocked(execGit)

beforeEach(() => {
  execGitMock.mockReset()
})

describe('cloneBare', () => {
  it('clones the remote as a bare repo', async () => {
    execGitMock.mockResolvedValue({ stdout: '', stderr: '' })

    await cloneBare('git@example.com:foo/bar.git', '/cache/foo-bar')

    expect(execGitMock).toHaveBeenCalledWith(['clone', '--bare', 'git@example.com:foo/bar.git', '/cache/foo-bar'], {})
  })

  it('forwards allowPrompts to execGit', async () => {
    execGitMock.mockResolvedValue({ stdout: '', stderr: '' })

    await cloneBare('git@example.com:foo/bar.git', '/cache/foo-bar', { allowPrompts: true })

    expect(execGitMock).toHaveBeenCalledWith(['clone', '--bare', 'git@example.com:foo/bar.git', '/cache/foo-bar'], { allowPrompts: true })
  })

  it('configures the standard remote-tracking fetch refspec, which --bare leaves unset', async () => {
    execGitMock.mockResolvedValue({ stdout: '', stderr: '' })

    await cloneBare('git@example.com:foo/bar.git', '/cache/foo-bar')

    expect(execGitMock).toHaveBeenLastCalledWith(
      ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'],
      { cwd: '/cache/foo-bar' },
    )
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
