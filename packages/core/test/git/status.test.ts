import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../src/git/exec.js', () => ({
  execGit: vi.fn(),
}))

const { execGit } = await import('../../src/git/exec.js')
const { getStatus } = await import('../../src/git/status.js')

const execGitMock = vi.mocked(execGit)

beforeEach(() => {
  execGitMock.mockReset()
})

describe('getStatus', () => {
  it('reports a clean worktree', async () => {
    execGitMock.mockImplementation(async (args) => {
      if (args[0] === 'rev-parse') return { stdout: 'main\n', stderr: '' }
      return { stdout: '', stderr: '' }
    })

    const status = await getStatus('/ws/foo')

    expect(status).toEqual({ branch: 'main', isClean: true, changedFiles: 0 })
    expect(execGitMock).toHaveBeenCalledWith(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: '/ws/foo' })
    expect(execGitMock).toHaveBeenCalledWith(['status', '--porcelain'], { cwd: '/ws/foo' })
  })

  it('counts changed files and reports dirty', async () => {
    execGitMock.mockImplementation(async (args) => {
      if (args[0] === 'rev-parse') return { stdout: 'feature\n', stderr: '' }
      return { stdout: ' M src/index.ts\n?? new-file.ts\n', stderr: '' }
    })

    const status = await getStatus('/ws/foo')

    expect(status).toEqual({ branch: 'feature', isClean: false, changedFiles: 2 })
  })

  it('passes through the literal "HEAD" git reports for a detached checkout', async () => {
    execGitMock.mockImplementation(async (args) => {
      if (args[0] === 'rev-parse') return { stdout: 'HEAD\n', stderr: '' }
      return { stdout: '', stderr: '' }
    })

    const status = await getStatus('/ws/foo')

    expect(status.branch).toBe('HEAD')
  })
})
