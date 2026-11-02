import { fastForwardBranch, type FastForwardOutcome } from '../git/fetch.js'
import { remoteHasBranch } from '../git/remote.js'
import { addWorktree, isBranchExistsError, isWorktreeCollisionError } from '../git/worktree.js'
import { withRepoLock } from '../repo/lock.js'
import { localRepoRegistryPath, resolveScopedRepoAlias } from '../registry/repoRegistry.js'
import { SporkError } from '../errors.js'

/**
 * Whether `aliasOrSource`'s remote already has a branch named `branch` —
 * normally the workspace's own name, i.e. a workspace branch that was
 * pushed. Resolves the alias the same way `addRepo` does (local to
 * `workspaceDir`, then global), so a frontend can ask this *before* adding
 * anything and offer `AddRepoOptions.fetchRemoteBranch`. Talks to the
 * remote directly, so it works before the repo is ever cloned; an
 * unreachable remote answers `false`.
 */
export async function remoteHasWorkspaceBranch(
  ctx: { reposRoot: string; repoRegistryPath: string },
  workspaceDir: string,
  aliasOrSource: string,
  branch: string,
): Promise<boolean> {
  const source = await resolveScopedRepoAlias(
    ctx.reposRoot,
    localRepoRegistryPath(workspaceDir),
    ctx.repoRegistryPath,
    aliasOrSource,
  )
  return remoteHasBranch(source, branch)
}

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
 * letting git's own failure surface as-is.
 */
export async function checkOutWorkspaceBranch(
  cache: { path: string; lockPath: string },
  worktreePath: string,
  localBranch: string,
  requestedRef: string,
  source: string,
  fetchRemoteBranch: boolean,
): Promise<CheckOutResult> {
  try {
    return await withRepoLock(cache.lockPath, async () => {
      const remoteBranch = fetchRemoteBranch ? await fastForwardBranch(cache.path, localBranch) : undefined
      const { reusedExistingBranch } = await addWorktree(cache.path, worktreePath, localBranch, requestedRef)
      return { reusedExistingBranch, remoteBranch }
    })
  } catch (error) {
    if (isBranchExistsError(error) || isWorktreeCollisionError(error)) {
      throw new SporkError(
        `Branch "${localBranch}" is already checked out elsewhere in the cache for "${source}" (${cache.path}) and can't be reused here. Resolve that checkout first, or create this workspace under a different name.`,
      )
    }
    throw error
  }
}
