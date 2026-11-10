import { defaultAlias, type RepoRemoteAccess } from '@spork/core'
import { confirm, NotInteractiveError } from '@spork/prompts'

export interface RemoteBranchDecision {
  /** The repos (sources, as given) to start from the remote branch: only ever ones whose remote has it. */
  fetchFrom: string[]
  /** Set when a remote branch was found but there was no TTY to ask about it. */
  notice?: string
}

/**
 * Decides `addRepo`'s `fetchRemoteBranch` for each repo in a batch about
 * to be added to a workspace, from what `prepareRemoteAccess` already
 * found per repo (`hasBranch` — the workspace's own name, so a match means
 * a workspace branch someone pushed). Only repos whose remote has the
 * branch ever start from it: the others have nothing to fetch, so they
 * start fresh whatever the answer. Runs *before* the live dashboard starts —
 * nothing can prompt while it's drawing, and the adds run concurrently —
 * so it's one question for the whole batch, not one per repo.
 *
 * `explicit` is the command's `--from-remote-branch`/`--no-from-remote-branch`
 * and wins outright (still only for repos that have the branch).
 * Otherwise, if any repo has the branch, confirms
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
  const pushed = repos.filter((repo) => repo.hasBranch).map((repo) => repo.source)
  if (explicit !== undefined) return { fetchFrom: explicit ? pushed : [] }
  if (pushed.length === 0) return { fetchFrom: [] }

  const where = `Branch "${branch}" already exists on the remote for ${pushed.map((source) => defaultAlias(source)).join(', ')}`
  try {
    return { fetchFrom: (await confirm({ message: `${where}. Start from the remote branch?` })) ? pushed : [] }
  } catch (error) {
    if (error instanceof NotInteractiveError) {
      return { fetchFrom: [], notice: `${where}; pass --from-remote-branch to start from it.` }
    }
    throw error
  }
}
