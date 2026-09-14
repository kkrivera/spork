import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../src/git/exec.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/git/exec.js')>('../../src/git/exec.js')
  return {
    execGit: vi.fn(),
    GitCommandError: actual.GitCommandError,
  }
})

const { execGit, GitCommandError } = await import('../../src/git/exec.js')
const { addWorktree, removeWorktree, pruneWorktrees, listWorktrees, isWorktreeCollisionError } = await import(
  '../../src/git/worktree.js'
)

const execGitMock = vi.mocked(execGit)

beforeEach(() => {
  execGitMock.mockReset()
})

describe('addWorktree', () => {
  it('creates the worktree on a new spork-owned local branch', async () => {
    execGitMock.mockResolvedValue({ stdout: '', stderr: '' })

    await addWorktree('/cache/foo', '/ws/foo', 'spork/demo/foo', 'origin/main')

    expect(execGitMock).toHaveBeenCalledWith(
      ['worktree', 'add', '-b', 'spork/demo/foo', '/ws/foo', 'origin/main'],
      { cwd: '/cache/foo' },
    )
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
        'branch refs/heads/spork/demo/bar',
        'prunable gitdir file points to non-existent location',
        '',
      ].join('\n'),
      stderr: '',
    })

    const entries = await listWorktrees('/cache/foo')

    expect(entries).toEqual([
      { path: '/cache/foo', branch: 'main', head: 'abc123', isPrunable: false },
      { path: '/ws/foo/bar', branch: 'spork/demo/bar', head: 'def456', isPrunable: true },
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
