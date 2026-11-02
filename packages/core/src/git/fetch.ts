import { execGit, type PromptOptions } from './exec.js'
import { listWorktrees } from './worktree.js'

/**
 * The refspec a normal (non-bare) clone gets: remote branches land in
 * `refs/remotes/origin/*`, never in local `refs/heads/*`. Worktrees share
 * their bare cache's config, so this is what a plain `git fetch`/`git pull`
 * run by hand inside a workspace uses — it must not map onto local branches,
 * or git refuses the whole fetch whenever any pushed workspace branch checked
 * out in some *other* worktree has drifted from its remote copy.
 */
const STANDARD_FETCH_REFSPEC = '+refs/heads/*:refs/remotes/origin/*'

const FULL_SHA = /^[0-9a-f]{40}$/i

/**
 * Sets the cache's configured fetch refspec to `STANDARD_FETCH_REFSPEC`.
 * `git clone --bare` configures none at all, and caches from before this
 * existed have `+refs/heads/*:refs/heads/*` — `git config` replaces rather
 * than accumulates, so re-asserting it on every fetch self-heals those.
 */
export async function configureFetchRefspec(bareRepoPath: string): Promise<void> {
  await execGit(['config', 'remote.origin.fetch', STANDARD_FETCH_REFSPEC], { cwd: bareRepoPath })
}

/**
 * Refreshes only what a new worktree is about to start from — `ref` itself
 * (`'HEAD'` meaning the cache's default branch), fetched straight into the
 * cache's matching local ref so `addWorktree` builds from the real upstream
 * tip. Deliberately never a fetch of everything: every workspace branch is a
 * local branch in this same cache, and once one has been pushed, a
 * whole-namespace fetch would try to force-overwrite it with the remote copy
 * (refused outright if it's checked out, silently losing unpushed commits if
 * not). For the same reason a requested branch that's checked out in some
 * worktree right now is skipped — the local copy is authoritative there.
 *
 * A ref the remote doesn't have (a local-only branch, a short sha) fetches
 * nothing and is left for `resolveRef` to find locally. A full sha is
 * fetched directly only when the cache doesn't already have it.
 */
export async function fetchRef(bareRepoPath: string, ref = 'HEAD', options: PromptOptions = {}): Promise<void> {
  await configureFetchRefspec(bareRepoPath)
  const refspecs = await refspecsFor(bareRepoPath, ref, options)
  if (refspecs.length === 0) return
  await execGit(['fetch', '--no-tags', 'origin', ...refspecs], { cwd: bareRepoPath, ...options })
}

async function refspecsFor(bareRepoPath: string, ref: string, options: PromptOptions): Promise<string[]> {
  if (FULL_SHA.test(ref)) return (await hasCommit(bareRepoPath, ref)) ? [] : [ref]

  const remoteRefs = ref === 'HEAD' ? [await headRef(bareRepoPath)] : await matchingRemoteRefs(bareRepoPath, ref, options)
  const checkedOut = await checkedOutRefs(bareRepoPath)
  return remoteRefs.filter((name) => !checkedOut.has(name)).map((name) => `+${name}:${name}`)
}

/** The full ref the cache's HEAD points at, e.g. `refs/heads/main`. */
async function headRef(bareRepoPath: string): Promise<string> {
  const { stdout } = await execGit(['symbolic-ref', 'HEAD'], { cwd: bareRepoPath })
  return stdout.trim()
}

/** Which of `refs/heads/<ref>`/`refs/tags/<ref>` (or `ref` itself, if already a full ref) the remote actually has. */
async function matchingRemoteRefs(bareRepoPath: string, ref: string, options: PromptOptions): Promise<string[]> {
  const candidates = ref.startsWith('refs/') ? [ref] : [`refs/heads/${ref}`, `refs/tags/${ref}`]
  const { stdout } = await execGit(['ls-remote', 'origin', ...candidates], { cwd: bareRepoPath, ...options })
  // ls-remote patterns match on a trailing path component, not the whole
  // name (and list `^{}` peeled entries for annotated tags), so keep exact matches only.
  const advertised = new Set(stdout.split('\n').map((line) => line.split('\t')[1]?.trim()))
  return candidates.filter((name) => advertised.has(name))
}

async function checkedOutRefs(bareRepoPath: string): Promise<Set<string>> {
  const worktrees = await listWorktrees(bareRepoPath)
  return new Set(worktrees.flatMap((worktree) => (worktree.branch ? [`refs/heads/${worktree.branch}`] : [])))
}

async function hasCommit(bareRepoPath: string, sha: string): Promise<boolean> {
  try {
    await execGit(['cat-file', '-e', `${sha}^{commit}`], { cwd: bareRepoPath })
    return true
  } catch {
    return false
  }
}
