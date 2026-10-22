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

const { execGit, GitAuthError, GitCommandError } = await import('../../src/git/exec.js')

beforeEach(() => {
  execFileMock.mockReset()
})

describe('execGit', () => {
  it('resolves stdout/stderr on success', async () => {
    execFileMock.mockResolvedValue({ stdout: 'ok\n', stderr: '' })

    const result = await execGit(['status'], { cwd: '/repo' })

    expect(result).toEqual({ stdout: 'ok\n', stderr: '' })
    expect(execFileMock).toHaveBeenCalledWith('git', ['status'], { cwd: '/repo', env: expect.objectContaining({ GIT_TERMINAL_PROMPT: '0' }) })
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

describe('execGit — prompts and auth failures', () => {

  it('turns off git and ssh prompts by default', async () => {
    execFileMock.mockResolvedValue({ stdout: '', stderr: '' })

    await execGit(['fetch'])

    const [, , options] = execFileMock.mock.calls[0] as [string, string[], { env: Record<string, string> }]
    expect(options.env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', SSH_ASKPASS: 'false', SSH_ASKPASS_REQUIRE: 'force' })
    expect(options.env.PATH).toBe(process.env.PATH)
  })

  it('inherits the environment untouched when prompts are allowed', async () => {
    execFileMock.mockResolvedValue({ stdout: '', stderr: '' })

    await execGit(['fetch'], { cwd: '/repo', allowPrompts: true })

    expect(execFileMock).toHaveBeenCalledWith('git', ['fetch'], { cwd: '/repo' })
  })

  it('wraps an auth failure as GitAuthError, with guidance on what to do next', async () => {
    execFileMock.mockRejectedValue({ stderr: 'git@github.com: Permission denied (publickey).\n' })

    const error = await execGit(['clone', '--bare', 'git@github.com:acme/widgets.git', '/c']).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(GitAuthError)
    expect(error).toBeInstanceOf(GitCommandError)
    expect((error as Error).message).toContain('Permission denied (publickey)')
    expect((error as Error).message).toContain('ssh-add')
    expect((error as Error).message).toContain('spork repo add <source>')
  })

  it("leaves out the 'run it in a terminal' advice when prompts were already allowed", async () => {
    execFileMock.mockRejectedValue({ stderr: 'git@github.com: Permission denied (publickey).\n' })

    const error = await execGit(['fetch'], { allowPrompts: true }).catch((e: unknown) => e)

    expect((error as Error).message).toContain('ssh-add')
    expect((error as Error).message).not.toContain('spork repo add <source>')
  })

  it('keeps a non-auth failure a plain GitCommandError', async () => {
    execFileMock.mockRejectedValue({ stderr: "fatal: repository 'x' does not exist\n" })

    const error = await execGit(['clone', 'x']).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(GitCommandError)
    expect(error).not.toBeInstanceOf(GitAuthError)
  })
})
