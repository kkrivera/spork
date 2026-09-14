import { mkdir } from 'node:fs/promises'

/**
 * A stand-in for the real `addWorktree` that only needs to be true to the one
 * side effect the rest of workspace.ts's logic (reconcile in particular)
 * actually observes: the worktree folder exists on disk afterwards.
 */
export async function fakeAddWorktree(_bareRepoPath: string, worktreePath: string): Promise<void> {
  await mkdir(worktreePath, { recursive: true })
}
