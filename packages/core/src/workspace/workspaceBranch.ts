import type { RemoteOptions } from '../git/exec.js'
import { conflictingBranchIn } from '../git/branchConflict.js'
import { fastForwardBranch, type FastForwardOutcome } from '../git/fetch.js'
import { addWorktree, isBranchExistsError, isWorktreeCollisionError } from '../git/worktree.js'
import { withRepoLock } from '../repo/lock.js'
import { repoShortName } from '../util/repoName.js'
import { SporkError } from '../errors.js'

export interface CheckOutResult {
  reusedExistingBranch: boolean
  remoteBranch?: FastForwardOutcome
}

/**
 * Creates the worktree — reusing `localBranch` as-is if it already exists in
 * this repo's cache (e.g. a previous, removed workspace of the same name
 * touched it before), or creating it fresh from `requestedRef` otherwise —
 * and returns whether it reused an existing branch. With
 * `fetchRemoteBranch`, first fast-forwards `localBranch` from the remote
 * (creating it if missing), so a pushed workspace branch is what gets
 * reused. The one thing this can't resolve is `localBranch` already being
 * checked out *elsewhere* right now (`isWorktreeCollisionError`;
 * `isBranchExistsError` is kept as a defensive fallback for a
 * check-then-act race, though `addWorktree`'s own existence check means it
 * shouldn't normally fire) — a branch can only be checked out in one
 * worktree at a time, so that still becomes a clear `SporkError` instead of
 * letting git's own failure surface as-is. So does `localBranch` clashing
 * with another branch's name (`git/branchConflict.ts`), which a frontend
 * normally catches before adding anything (`prepareRemoteAccess`).
 */
export async function checkOutWorkspaceBranch(
  cache: { path: string; lockPath: string },
  worktreePath: string,
  localBranch: string,
  requestedRef: string,
  source: string,
  fetchRemoteBranch: boolean,
  remote: RemoteOptions = {},
): Promise<CheckOutResult> {
  try {
    return await withRepoLock(cache.lockPath, async () => {
      const remoteBranch = fetchRemoteBranch ? await fastForwardBranch(cache.path, localBranch, remote) : undefined
      const { reusedExistingBranch } = await addWorktree(cache.path, worktreePath, localBranch, requestedRef)
      return { reusedExistingBranch, remoteBranch }
    })
  } catch (error) {
    const clash = conflictingBranchIn(error)
    if (clash) throw new SporkError(branchConflictMessage(localBranch, repoShortName(source), [clash]))
    if (isBranchExistsError(error) || isWorktreeCollisionError(error)) {
      throw new SporkError(
        `Branch "${localBranch}" is already checked out elsewhere in the cache for "${source}" (${cache.path}) and can't be reused here. Resolve that checkout first, or create this workspace under a different name.`,
      )
    }
    throw error
  }
}

/**
 * Why `branch` can't be the workspace's branch in `repo`, given the
 * branches there that clash with it (see `git/branchConflict.ts`'s
 * `branchesConflict`). Worded for both `create` and `add-repo`: either
 * way, the fix is a workspace with a different name.
 */
export function branchConflictMessage(branch: string, repo: string, conflicts: readonly string[]): string {
  const parent = conflicts.find((name) => branch.startsWith(`${name}/`))
  const reason = parent
    ? `it already has a branch named "${parent}"`
    : `it already has ${conflicts.length === 1 ? 'a branch' : 'branches'} under "${branch}/" (${listSome(conflicts)})`
  return `Can't use "${branch}" as the workspace branch in ${repo}: ${reason}, and git can't have both. Use a different workspace name for this repo.`
}

function listSome(names: readonly string[]): string {
  const shown = names.slice(0, 3).join(', ')
  return names.length > 3 ? `${shown}, and ${names.length - 3} more` : shown
}
