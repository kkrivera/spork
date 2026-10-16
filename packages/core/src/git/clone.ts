import { execGit } from './exec.js'

/** Clones `remote` as a bare repo at `destination` — the shared cache for a repo source. */
export async function cloneBare(remote: string, destination: string): Promise<void> {
  await execGit(['clone', '--bare', remote, destination])
}

/**
 * Refreshes a bare cache's refs so newly-requested branches/tags, and the
 * latest tip of an already-known one, can be resolved.
 *
 * `git clone --bare` deliberately does *not* configure a fetch refspec —
 * "neither remote-tracking branches nor the related configuration
 * variables are created" (git-clone(1)) — so without this, `git fetch` has
 * nothing telling it to update `refs/heads/*` from the remote: it only
 * writes `FETCH_HEAD`, and the cache's branches stay frozen at whatever
 * they were at clone time, even after repeated "fetches," confirmed by
 * direct testing. This re-asserts the refspec (`git config`, which
 * replaces rather than accumulates, so it's safe to call every time) before
 * every fetch rather than relying on it having been set once at clone
 * time, so a cache that already existed before this fix still self-heals
 * the next time anything touches it. Deliberately has no `--prune`: that
 * would delete any local `refs/heads/*` entry missing from the remote —
 * including every spork-owned workspace branch, since those are local-only
 * and never exist upstream.
 */
export async function fetchAll(bareRepoPath: string): Promise<void> {
  await execGit(['config', 'remote.origin.fetch', '+refs/heads/*:refs/heads/*'], { cwd: bareRepoPath })
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
