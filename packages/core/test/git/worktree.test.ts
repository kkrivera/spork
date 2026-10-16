import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../src/git/exec.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/git/exec.js')>('../../src/git/exec.js')
  return {
    execGit: vi.fn(),
    GitCommandError: actual.GitCommandError,
  }
})

const { execGit, GitCommandError } = await import('../../src/git/exec.js')
const {
  addWorktree,
  branchExists,
  removeWorktree,
  pruneWorktrees,
  listWorktrees,
  isWorktreeCollisionError,
  isBranchExistsError,
} = await import('../../src/git/worktree.js')

const execGitMock = vi.mocked(execGit)

beforeEach(() => {
  execGitMock.mockReset()
})

/** show-ref --verify always "fails" (branch not found), everything else succeeds. */
function mockNoBranchExists(): void {
  execGitMock.mockImplementation(async (args) => {
    if (args[0] === 'show-ref') throw new GitCommandError(args, 'not found')
    return { stdout: '', stderr: '' }
  })
}

describe('addWorktree — creating fresh', () => {
  it('creates the worktree on a new local branch when none exists yet', async () => {
    mockNoBranchExists()

    await addWorktree('/cache/foo', '/ws/foo', 'demo', 'origin/main')

    expect(execGitMock).toHaveBeenCalledWith(['worktree', 'add', '-b', 'demo', '/ws/foo', 'origin/main'], {
      cwd: '/cache/foo',
    })
  })

  it('reports reusedExistingBranch: false', async () => {
    mockNoBranchExists()

    expect(await addWorktree('/cache/foo', '/ws/foo', 'demo', 'origin/main')).toEqual({
      reusedExistingBranch: false,
    })
  })
})

describe('addWorktree — reusing an existing branch', () => {
  it('checks out the existing branch as-is, without -b or a start point', async () => {
    execGitMock.mockResolvedValue({ stdout: '', stderr: '' }) // show-ref succeeds: branch exists

    await addWorktree('/cache/foo', '/ws/foo', 'demo', 'origin/main')

    expect(execGitMock).toHaveBeenCalledWith(['worktree', 'add', '/ws/foo', 'demo'], { cwd: '/cache/foo' })
  })

  it('reports reusedExistingBranch: true', async () => {
    execGitMock.mockResolvedValue({ stdout: '', stderr: '' })

    expect(await addWorktree('/cache/foo', '/ws/foo', 'demo', 'origin/main')).toEqual({
      reusedExistingBranch: true,
    })
  })
})

describe('branchExists', () => {
  it('returns true when show-ref succeeds', async () => {
    execGitMock.mockResolvedValue({ stdout: '', stderr: '' })

    expect(await branchExists('/cache/foo', 'demo')).toBe(true)
    expect(execGitMock).toHaveBeenCalledWith(['show-ref', '--verify', '--quiet', 'refs/heads/demo'], {
      cwd: '/cache/foo',
    })
  })

  it('returns false when show-ref fails', async () => {
    execGitMock.mockRejectedValue(new GitCommandError(['show-ref'], 'not found'))

    expect(await branchExists('/cache/foo', 'demo')).toBe(false)
  })
})

describe('removeWorktree', () => {
  it('removes without --force by default', async () => {
    execGitMock.mockResolvedValue({ stdout: '', stderr: '' })

    await removeWorktree('/cache/foo', '/ws/foo')

    expect(execGitMock).toHaveBeenCalledWith(['worktree', 'remove', '/ws/foo'], { cwd: '/cache/foo' })
  })

  it('passes --force when requested', async () => {
    execGitMock.mockResolvedValue({ stdout: '', stderr: '' })

    await removeWorktree('/cache/foo', '/ws/foo', { force: true })

    expect(execGitMock).toHaveBeenCalledWith(['worktree', 'remove', '/ws/foo', '--force'], { cwd: '/cache/foo' })
  })
})

describe('pruneWorktrees', () => {
  it('runs worktree prune', async () => {
    execGitMock.mockResolvedValue({ stdout: '', stderr: '' })

    await pruneWorktrees('/cache/foo')

    expect(execGitMock).toHaveBeenCalledWith(['worktree', 'prune'], { cwd: '/cache/foo' })
  })
})

describe('listWorktrees', () => {
  it('parses porcelain output into entries, including prunable ones', async () => {
    execGitMock.mockResolvedValue({
      stdout: [
        'worktree /cache/foo',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
        'worktree /ws/foo/bar',
        'HEAD def456',
        'branch refs/heads/demo',
        'prunable gitdir file points to non-existent location',
        '',
      ].join('\n'),
      stderr: '',
    })

    const entries = await listWorktrees('/cache/foo')

    expect(entries).toEqual([
      { path: '/cache/foo', branch: 'main', head: 'abc123', isPrunable: false },
      { path: '/ws/foo/bar', branch: 'demo', head: 'def456', isPrunable: true },
    ])
  })

  it('returns an empty list for empty output', async () => {
    execGitMock.mockResolvedValue({ stdout: '', stderr: '' })

    expect(await listWorktrees('/cache/foo')).toEqual([])
  })

  it('handles a detached HEAD entry with no branch line', async () => {
    execGitMock.mockResolvedValue({
      stdout: ['worktree /cache/foo', 'HEAD abc123', 'detached', ''].join('\n'),
      stderr: '',
    })

    expect(await listWorktrees('/cache/foo')).toEqual([
      { path: '/cache/foo', branch: null, head: 'abc123', isPrunable: false },
    ])
  })
})

describe('isWorktreeCollisionError', () => {
  it('recognizes a "already checked out" GitCommandError', () => {
    const error = new GitCommandError(
      ['worktree', 'add'],
      "fatal: 'main' is already checked out at '/other/path'\n",
    )

    expect(isWorktreeCollisionError(error)).toBe(true)
  })

  it('recognizes a "already used by worktree" GitCommandError', () => {
    const error = new GitCommandError(['worktree', 'add'], "fatal: branch already used by worktree\n")

    expect(isWorktreeCollisionError(error)).toBe(true)
  })

  it('returns false for an unrelated error', () => {
    const error = new GitCommandError(['worktree', 'add'], 'fatal: not a git repository\n')

    expect(isWorktreeCollisionError(error)).toBe(false)
  })

  it('returns false for a non-GitCommandError value', () => {
    expect(isWorktreeCollisionError(new Error('boom'))).toBe(false)
  })
})

describe('isBranchExistsError', () => {
  it('recognizes a "branch already exists" GitCommandError', () => {
    const error = new GitCommandError(['worktree', 'add', '-b', 'demo'], "fatal: a branch named 'demo' already exists\n")

    expect(isBranchExistsError(error)).toBe(true)
  })

  it('returns false for an unrelated error', () => {
    const error = new GitCommandError(['worktree', 'add'], 'fatal: not a git repository\n')

    expect(isBranchExistsError(error)).toBe(false)
  })

  it('returns false for a non-GitCommandError value', () => {
    expect(isBranchExistsError(new Error('boom'))).toBe(false)
  })
})
