import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/git/exec.js', () => ({
  execGit: vi.fn(),
}))

const { execGit } = await import('../../src/git/exec.js')
const { getRemoteUrl, setRemoteUrl, getRemoteDefaultBranch } = await import('../../src/git/remote.js')

const execGitMock = vi.mocked(execGit)

describe('getRemoteUrl', () => {
  it('returns the trimmed remote url when the remote exists', async () => {
    execGitMock.mockReset().mockResolvedValue({ stdout: 'git@github.com:acme/widgets.git\n', stderr: '' })

    const url = await getRemoteUrl('/repos/widgets', 'origin')

    expect(url).toBe('git@github.com:acme/widgets.git')
    expect(execGitMock).toHaveBeenCalledWith(['remote', 'get-url', 'origin'], { cwd: '/repos/widgets' })
  })

  it('defaults the remote name to origin', async () => {
    execGitMock.mockReset().mockResolvedValue({ stdout: 'https://example.com/x.git', stderr: '' })

    await getRemoteUrl('/repos/widgets')

    expect(execGitMock).toHaveBeenCalledWith(['remote', 'get-url', 'origin'], { cwd: '/repos/widgets' })
  })

  it('returns null when the remote does not exist', async () => {
    execGitMock.mockReset().mockRejectedValue(new Error('fatal: No such remote'))

    const url = await getRemoteUrl('/repos/widgets', 'origin')

    expect(url).toBeNull()
  })

  it('returns null when the remote url is blank', async () => {
    execGitMock.mockReset().mockResolvedValue({ stdout: '  \n', stderr: '' })

    const url = await getRemoteUrl('/repos/widgets')

    expect(url).toBeNull()
  })
})

describe('setRemoteUrl', () => {
  it('sets the remote url', async () => {
    execGitMock.mockReset().mockResolvedValue({ stdout: '', stderr: '' })

    await setRemoteUrl('/repos/widgets', 'origin', 'git@github.com:acme/widgets.git')

    expect(execGitMock).toHaveBeenCalledWith(['remote', 'set-url', 'origin', 'git@github.com:acme/widgets.git'], {
      cwd: '/repos/widgets',
    })
  })
})

describe('getRemoteDefaultBranch', () => {
  it('parses the default branch out of ls-remote --symref output', async () => {
    execGitMock.mockReset().mockResolvedValue({
      stdout: 'ref: refs/heads/trunk\tHEAD\n7b526f4\tHEAD\n',
      stderr: '',
    })

    const branch = await getRemoteDefaultBranch('git@github.com:acme/widgets.git')

    expect(branch).toBe('trunk')
    expect(execGitMock).toHaveBeenCalledWith(['ls-remote', '--symref', 'git@github.com:acme/widgets.git', 'HEAD'])
  })

  it('also works against a local path source', async () => {
    execGitMock.mockReset().mockResolvedValue({ stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' })

    const branch = await getRemoteDefaultBranch('/home/user/code/widgets')

    expect(branch).toBe('main')
  })

  it('returns null when the source is unreachable or not a git repo', async () => {
    execGitMock.mockReset().mockRejectedValue(new Error('fatal: could not read from remote'))

    const branch = await getRemoteDefaultBranch('git@github.com:acme/widgets.git')

    expect(branch).toBeNull()
  })

  it('returns null when the output does not contain a symref line', async () => {
    execGitMock.mockReset().mockResolvedValue({ stdout: '', stderr: '' })

    const branch = await getRemoteDefaultBranch('git@github.com:acme/widgets.git')

    expect(branch).toBeNull()
  })
})
