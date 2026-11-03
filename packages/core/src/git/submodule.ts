import { existsSync } from 'node:fs'
import path from 'node:path'
import { execGit, type RemoteOptions } from './exec.js'

/** `git worktree add` never initializes submodules on its own — check for a .gitmodules file to know whether to bother. */
export function hasSubmodules(worktreePath: string): boolean {
  return existsSync(path.join(worktreePath, '.gitmodules'))
}

export async function initSubmodules(worktreePath: string, options: RemoteOptions = {}): Promise<void> {
  await execGit(['submodule', 'update', '--init', '--recursive'], { cwd: worktreePath, ...options })
}
