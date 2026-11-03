import { defaultAlias, type RepoRemoteAccess } from '@spork/core'
import { confirm, NotInteractiveError } from '@spork/prompts'

export interface RemoteBranchDecision {
  fetchRemoteBranch: boolean
  /** Set when a remote branch was found but there was no TTY to ask about it. */
  notice?: string
}

/**
 * Decides `addRepo`'s `fetchRemoteBranch` for a batch of repos about to
 * be added to a workspace, from what `prepareRemoteAccess` already found
 * (`hasBranch` — the workspace's own name, so a match means a workspace
 * branch someone pushed). Runs *before* the live dashboard starts —
 * nothing can prompt while it's drawing, and the adds run concurrently —
 * so it's one question for the whole batch, not one per repo.
 *
 * `explicit` is the command's `--from-remote-branch`/`--no-from-remote-branch`
 * and wins outright. Otherwise, if any repo has the branch, confirms
 * whether to start from it (default yes: matching the pushed branch is
 * almost always what resuming a workspace means). Without a TTY there's no
 * one to ask, so it keeps the default of starting fresh and returns a
 * `notice` saying how to opt in, for the caller's `register*` side to
 * print (a `run*` function never prints itself). Esc just declines, the
 * same as "no": the add itself still goes ahead.
 */
export async function resolveFetchRemoteBranch(
  repos: readonly RepoRemoteAccess[],
  branch: string,
  explicit: boolean | undefined,
): Promise<RemoteBranchDecision> {
  if (explicit !== undefined) return { fetchRemoteBranch: explicit }

  const matches = repos.filter((repo) => repo.hasBranch).map((repo) => defaultAlias(repo.source))
  if (matches.length === 0) return { fetchRemoteBranch: false }

  const where = `Branch "${branch}" already exists on the remote for ${matches.join(', ')}`
  try {
    return { fetchRemoteBranch: await confirm({ message: `${where}. Start from the remote branch?` }) }
  } catch (error) {
    if (error instanceof NotInteractiveError) {
      return { fetchRemoteBranch: false, notice: `${where}; pass --from-remote-branch to start from it.` }
    }
    throw error
  }
}
