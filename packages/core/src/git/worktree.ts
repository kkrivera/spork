import { execGit, GitCommandError } from './exec.js'

export interface WorktreeEntry {
  path: string
  branch: string | null
  head: string
  isPrunable: boolean
}

export interface AddWorktreeResult {
  /** True if `localBranch` already existed in this repo's cache and was checked out as-is (continuing its history) rather than created fresh from `startPoint`. */
  reusedExistingBranch: boolean
}

/**
 * Creates a worktree at `worktreePath` on `localBranch` — shared by every
 * repo in the workspace it belongs to, rather than checking out the
 * requested ref directly (see
 * docs/plans/0001-worktree-workspace-architecture.md). If `localBranch`
 * already exists in this repo's cache (e.g. a previous, removed workspace
 * of the same name touched it before), checks it out as-is instead of
 * creating a duplicate or failing; otherwise creates it fresh from
 * `startPoint`. Still fails if `localBranch` is already checked out
 * elsewhere right now (`isWorktreeCollisionError`) — a branch can only be
 * checked out in one worktree at a time, which reuse can't work around.
 */
export async function addWorktree(
  bareRepoPath: string,
  worktreePath: string,
  localBranch: string,
  startPoint: string,
): Promise<AddWorktreeResult> {
  const reusedExistingBranch = await branchExists(bareRepoPath, localBranch)
  const args = reusedExistingBranch
    ? ['worktree', 'add', worktreePath, localBranch]
    : ['worktree', 'add', '-b', localBranch, worktreePath, startPoint]
  await execGit(args, { cwd: bareRepoPath })
  return { reusedExistingBranch }
}

/** True if `branch` already exists in this repo's cache, regardless of whether it's currently checked out anywhere. */
export async function branchExists(bareRepoPath: string, branch: string): Promise<boolean> {
  try {
    await execGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: bareRepoPath })
    return true
  } catch {
    return false
  }
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
