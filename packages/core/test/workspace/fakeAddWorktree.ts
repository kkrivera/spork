import { mkdir } from 'node:fs/promises'
import type { AddWorktreeResult } from '../../src/git/worktree.js'

/**
 * A stand-in for the real `addWorktree` that only needs to be true to the one
 * side effect the rest of workspace.ts's logic (reconcile in particular)
 * actually observes: the worktree folder exists on disk afterwards. Always
 * reports a fresh branch (not reused) — tests that specifically need reuse
 * behavior mock `addWorktree` directly instead of using this fake.
 */
export async function fakeAddWorktree(_bareRepoPath: string, worktreePath: string): Promise<AddWorktreeResult> {
  await mkdir(worktreePath, { recursive: true })
  return { reusedExistingBranch: false }
}
