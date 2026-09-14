import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../src/git/exec.js', () => ({
  execGit: vi.fn(),
}))

const { execGit } = await import('../../src/git/exec.js')
const { cloneBare, fetchAll, resolveRef } = await import('../../src/git/clone.js')

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
})

describe('resolveRef', () => {
  it('resolves a ref to a trimmed commit sha', async () => {
    execGitMock.mockResolvedValue({ stdout: 'abc123\n', stderr: '' })

    const sha = await resolveRef('/cache/foo-bar', 'main')

    expect(sha).toBe('abc123')
    expect(execGitMock).toHaveBeenCalledWith(['rev-parse', '--verify', 'main^{commit}'], { cwd: '/cache/foo-bar' })
  })
})
