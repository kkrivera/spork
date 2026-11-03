import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/git/exec.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/git/exec.js')>('../../src/git/exec.js')
  return { execGit: vi.fn(), GitCommandError: actual.GitCommandError }
})

const { execGit, GitCommandError } = await import('../../src/git/exec.js')
const { branchConflictPatterns, branchesConflict, conflictingBranchIn, findLocalBranchConflicts } = await import(
  '../../src/git/branchConflict.js'
)

const execGitMock = vi.mocked(execGit)

beforeEach(() => {
  execGitMock.mockReset()
})

describe('branchesConflict', () => {
  it('is true for a branch under the name, or a branch the name is under', () => {
    expect(branchesConflict('test', 'test/entra-install-snapshots')).toBe(true)
    expect(branchesConflict('test', 'test/a/b')).toBe(true)
    expect(branchesConflict('kris/test', 'kris')).toBe(true)
  })

  it('is false for the same name, a shared prefix, or an unrelated path', () => {
    expect(branchesConflict('test', 'test')).toBe(false)
    expect(branchesConflict('test', 'testing')).toBe(false)
    expect(branchesConflict('test', 'other/test')).toBe(false)
    expect(branchesConflict('kris/test', 'kris/test2')).toBe(false)
  })
})

describe('branchConflictPatterns', () => {
  it("covers each parent path exactly and everything under the name", () => {
    expect(branchConflictPatterns('test')).toEqual(['refs/heads/test/*'])
    expect(branchConflictPatterns('a/b/c')).toEqual(['refs/heads/a', 'refs/heads/a/b', 'refs/heads/a/b/c/*'])
  })
})

describe('findLocalBranchConflicts', () => {
  it("lists the cache's branches that clash, leaving out the branch itself", async () => {
    execGitMock.mockResolvedValue({ stdout: 'kris\nkris/test\nkris/test/a\n', stderr: '' })

    expect(await findLocalBranchConflicts('/cache', 'kris/test')).toEqual(['kris', 'kris/test/a'])
    expect(execGitMock).toHaveBeenCalledWith(
      ['for-each-ref', '--format=%(refname:strip=2)', 'refs/heads/kris', 'refs/heads/kris/test'],
      { cwd: '/cache' },
    )
  })
})

describe('conflictingBranchIn', () => {
  it("returns the branch named in git's refusal", () => {
    const error = new GitCommandError(
      ['worktree', 'add'],
      "Preparing worktree (new branch 'test')\nfatal: 'refs/heads/test/entra-install-snapshots' exists; cannot create 'refs/heads/test'",
    )

    expect(conflictingBranchIn(error)).toBe('test/entra-install-snapshots')
  })

  it('is null for any other failure', () => {
    expect(conflictingBranchIn(new GitCommandError(['worktree'], "fatal: 'test' is already checked out"))).toBeNull()
    expect(conflictingBranchIn(new Error("'refs/heads/x' exists; cannot create 'refs/heads/y'"))).toBeNull()
  })
})
