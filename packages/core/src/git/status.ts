import { execGit } from './exec.js'

export interface WorktreeStatus {
  branch: string | null
  isClean: boolean
  changedFiles: number
}

/** Local-only status (no fetch) — matches plain `git status`, and stays fast across many worktrees. */
export async function getStatus(worktreePath: string): Promise<WorktreeStatus> {
  const [branchResult, statusResult] = await Promise.all([
    execGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreePath }),
    execGit(['status', '--porcelain'], { cwd: worktreePath }),
  ])

  const changedFiles = statusResult.stdout.split('\n').filter((line) => line.trim().length > 0).length

  return {
    branch: branchResult.stdout.trim() || null,
    isClean: changedFiles === 0,
    changedFiles,
  }
}
