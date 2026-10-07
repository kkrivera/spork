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

/**
 * Repoints a bare cache's own HEAD at `branch`. A fresh `git clone --bare`
 * already sets HEAD to whatever the clone source reported as its default
 * branch — this is only needed to correct it afterward, e.g. when the clone
 * source was a local checkout (as with `repo scan`) rather than the repo's
 * real upstream, so HEAD ends up reflecting whichever branch happened to be
 * checked out locally instead of the upstream's actual default. Safe even if
 * `branch` doesn't exist in the cache yet — HEAD can symbolically point at a
 * not-yet-existent ref, the same way a brand-new repo's HEAD does, and
 * resolves once a later fetch brings the branch in.
 */
export async function setHeadBranch(bareRepoPath: string, branch: string): Promise<void> {
  await execGit(['symbolic-ref', 'HEAD', `refs/heads/${branch}`], { cwd: bareRepoPath })
}
