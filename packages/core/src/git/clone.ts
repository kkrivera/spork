import { execGit } from './exec.js'

/** Clones `remote` as a bare repo at `destination` — the shared cache for a repo source. */
export async function cloneBare(remote: string, destination: string): Promise<void> {
  await execGit(['clone', '--bare', remote, destination])
}

/** Refreshes a bare cache's refs so newly-requested branches/tags can be resolved. */
export async function fetchAll(bareRepoPath: string): Promise<void> {
  await execGit(['fetch', '--all', '--tags'], { cwd: bareRepoPath })
}

/** Resolves `ref` (branch, tag, or sha) to a commit sha within the bare cache. */
export async function resolveRef(bareRepoPath: string, ref: string): Promise<string> {
  const { stdout } = await execGit(['rev-parse', '--verify', `${ref}^{commit}`], { cwd: bareRepoPath })
  return stdout.trim()
}
