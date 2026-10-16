import { execGit, GitCommandError } from './exec.js'

export interface WorktreeEntry {
  path: string
  branch: string | null
  head: string
  isPrunable: boolean
}

/**
 * Creates a worktree at `worktreePath` on a new local branch (`localBranch`,
 * shared by every repo in the workspace it belongs to) starting from
 * `startPoint`, rather than checking out the requested ref directly — see
 * docs/plans/0001-worktree-workspace-architecture.md. Fails if `localBranch`
 * already exists in this repo's cache (`isBranchExistsError`) or is already
 * checked out elsewhere (`isWorktreeCollisionError`) — the caller decides
 * what to do about either.
 */
export async function addWorktree(
  bareRepoPath: string,
  worktreePath: string,
  localBranch: string,
  startPoint: string,
): Promise<void> {
  await execGit(['worktree', 'add', '-b', localBranch, worktreePath, startPoint], { cwd: bareRepoPath })
}

export async function removeWorktree(
  bareRepoPath: string,
  worktreePath: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const args = ['worktree', 'remove', worktreePath]
  if (options.force) args.push('--force')
  await execGit(args, { cwd: bareRepoPath })
}

/** Clears git's worktree metadata for any worktree whose folder no longer exists on disk. */
export async function pruneWorktrees(bareRepoPath: string): Promise<void> {
  await execGit(['worktree', 'prune'], { cwd: bareRepoPath })
}

export async function listWorktrees(bareRepoPath: string): Promise<WorktreeEntry[]> {
  const { stdout } = await execGit(['worktree', 'list', '--porcelain'], { cwd: bareRepoPath })
  return parsePorcelain(stdout)
}

/** True if `error` is git refusing to check out a ref/branch that's already in use elsewhere. */
export function isWorktreeCollisionError(error: unknown): boolean {
  return error instanceof GitCommandError && /already (checked out|used by worktree)/i.test(error.stderr)
}

/** True if `error` is git refusing to create a branch (`worktree add -b`) that already exists. */
export function isBranchExistsError(error: unknown): boolean {
  return error instanceof GitCommandError && /already exists/i.test(error.stderr)
}

function parsePorcelain(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let current: Partial<WorktreeEntry> = {}

  const flush = () => {
    if (current.path) {
      entries.push({
        path: current.path,
        branch: current.branch ?? null,
        head: current.head ?? '',
        isPrunable: current.isPrunable ?? false,
      })
    }
    current = {}
  }

  for (const line of output.split('\n')) {
    if (line === '') {
      flush()
      continue
    }
    const spaceIndex = line.indexOf(' ')
    const key = spaceIndex === -1 ? line : line.slice(0, spaceIndex)
    const value = spaceIndex === -1 ? '' : line.slice(spaceIndex + 1)

    if (key === 'worktree') current.path = value
    else if (key === 'HEAD') current.head = value
    else if (key === 'branch') current.branch = value.replace('refs/heads/', '')
    else if (key === 'prunable') current.isPrunable = true
  }
  flush()

  return entries
}
