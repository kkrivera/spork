import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/repo/lock.js', () => ({
  withRepoLock: vi.fn((_target: string, fn: () => Promise<unknown>) => fn()),
}))
vi.mock('../../src/git/worktree.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/git/worktree.js')>('../../src/git/worktree.js')
  return { ...actual, addWorktree: vi.fn() }
})

const { addWorktree } = await import('../../src/git/worktree.js')
const { GitCommandError } = await import('../../src/git/exec.js')
const { checkOutWorkspaceBranch } = await import('../../src/workspace/workspaceBranch.js')
const { SporkError } = await import('../../src/errors.js')

const CACHE = { path: '/repos/app', lockPath: '/repos/.locks/app' }

describe('checkOutWorkspaceBranch', () => {
  it("turns git's refusal of a clashing branch name into a clear error, in case nothing caught it earlier", async () => {
    vi.mocked(addWorktree).mockRejectedValue(
      new GitCommandError(['worktree', 'add'], "fatal: 'refs/heads/test/entra-install-snapshots' exists; cannot create 'refs/heads/test'"),
    )

    const failure = checkOutWorkspaceBranch(CACHE, '/ws/test/app', 'test', 'HEAD', 'git@github.com:acme/app.git', false)

    await expect(failure).rejects.toBeInstanceOf(SporkError)
    await expect(failure).rejects.toThrow(
      'Can\'t use "test" as the workspace branch in app: it already has a branch under "test/" (test/entra-install-snapshots)',
    )
  })
})
