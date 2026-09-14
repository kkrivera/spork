import { describe, expect, it, vi, beforeEach } from 'vitest'

const execFileMock = vi.fn()

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const callback = args[args.length - 1] as (error: unknown, result: unknown) => void
    execFileMock(...args.slice(0, -1))
      .then((result: unknown) => callback(null, result))
      .catch((error: unknown) => callback(error, null))
  },
}))

const { execGit, GitCommandError } = await import('../../src/git/exec.js')

beforeEach(() => {
  execFileMock.mockReset()
})

describe('execGit', () => {
  it('resolves stdout/stderr on success', async () => {
    execFileMock.mockResolvedValue({ stdout: 'ok\n', stderr: '' })

    const result = await execGit(['status'], { cwd: '/repo' })

    expect(result).toEqual({ stdout: 'ok\n', stderr: '' })
    expect(execFileMock).toHaveBeenCalledWith('git', ['status'], { cwd: '/repo' })
  })

  it('wraps a failure as GitCommandError with the args and stderr', async () => {
    execFileMock.mockRejectedValue({ stderr: 'fatal: not a git repository\n' })

    await expect(execGit(['status'])).rejects.toMatchObject({
      name: 'GitCommandError',
      args: ['status'],
      stderr: 'fatal: not a git repository\n',
    })
    await expect(execGit(['status'])).rejects.toBeInstanceOf(GitCommandError)
  })

  it('handles a thrown error with no stderr field', async () => {
    execFileMock.mockRejectedValue(new Error('spawn git ENOENT'))

    await expect(execGit(['status'])).rejects.toMatchObject({ stderr: '' })
  })
})
