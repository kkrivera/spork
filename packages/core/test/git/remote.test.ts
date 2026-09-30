import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/git/exec.js', () => ({
  execGit: vi.fn(),
}))

const { execGit } = await import('../../src/git/exec.js')
const { getRemoteUrl, setRemoteUrl } = await import('../../src/git/remote.js')

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
