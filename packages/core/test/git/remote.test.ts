import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/git/exec.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/git/exec.js')>('../../src/git/exec.js')
  return { execGit: vi.fn(), GitAuthError: actual.GitAuthError }
})

const { execGit } = await import('../../src/git/exec.js')
const { GitAuthError } = await import('../../src/git/exec.js')
const { getRemoteUrl, setRemoteUrl, getRemoteDefaultBranch, probeRemote } = await import('../../src/git/remote.js')

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

describe('probeRemote', () => {
  const SOURCE = 'git@github.com:acme/widgets.git'

  it('reaches the remote and finds exactly that branch', async () => {
    execGitMock.mockReset().mockResolvedValue({ stdout: 'abc123\trefs/heads/me/feature\n', stderr: '' })

    expect(await probeRemote(SOURCE, 'me/feature')).toEqual({ status: 'ok', hasBranch: true, conflicts: [] })
    expect(execGitMock).toHaveBeenCalledWith(
      ['ls-remote', SOURCE, 'refs/heads/me/feature', 'refs/heads/me', 'refs/heads/me/feature/*'],
      {},
    )
  })

  it('ignores a branch that only ends with the same path, and a remote without the branch', async () => {
    execGitMock.mockReset().mockResolvedValueOnce({ stdout: 'abc123\trefs/heads/other/me/feature\n', stderr: '' })
    execGitMock.mockResolvedValueOnce({ stdout: '', stderr: '' })

    expect(await probeRemote(SOURCE, 'me/feature')).toEqual({ status: 'ok', hasBranch: false, conflicts: [] })
    expect(await probeRemote(SOURCE, 'me/feature')).toEqual({ status: 'ok', hasBranch: false, conflicts: [] })
  })

  it('goes through the given ssh-agent', async () => {
    execGitMock.mockReset().mockResolvedValue({ stdout: '', stderr: '' })

    await probeRemote(SOURCE, 'main', { sshAuthSock: '/tmp/agent.sock' })

    expect(execGitMock).toHaveBeenCalledWith(['ls-remote', SOURCE, 'refs/heads/main', 'refs/heads/main/*'], {
      sshAuthSock: '/tmp/agent.sock',
    })
  })

  it('reports an authentication failure separately from any other failure', async () => {
    execGitMock.mockReset().mockRejectedValueOnce(new GitAuthError(['ls-remote'], 'Permission denied (publickey).', false))
    execGitMock.mockRejectedValueOnce(new Error('Could not resolve hostname'))

    expect(await probeRemote(SOURCE, 'main')).toEqual({ status: 'auth-failed', hasBranch: false, conflicts: [] })
    expect(await probeRemote(SOURCE, 'main')).toEqual({ status: 'unreachable', hasBranch: false, conflicts: [] })
  })

  it('reports branches that clash with the name, but not ones that only share a prefix or tail', async () => {
    execGitMock.mockReset().mockResolvedValue({
      stdout: ['refs/heads/test/a', 'refs/heads/test/b/c', 'refs/heads/other/test/x', 'refs/tags/test/v1'].map((ref) => `abc\t${ref}\n`).join(''),
      stderr: '',
    })

    expect(await probeRemote(SOURCE, 'test')).toEqual({ status: 'ok', hasBranch: false, conflicts: ['test/a', 'test/b/c'] })
  })
})
