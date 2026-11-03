import { probeRemote, type RemoteAccessStatus, type RemoteProbe } from '../git/remote.js'
import { localRepoRegistryPath, resolveScopedRepoAlias } from '../registry/repoRegistry.js'
import { startTemporaryAgent, type TemporaryAgent } from '../ssh/agent.js'
import { findLockedKeys } from '../ssh/keys.js'
import { parseSshTarget, sshTargetKey, type SshTarget } from '../ssh/target.js'

export interface RepoRemoteAccess {
  /** The alias or source exactly as given. */
  source: string
  status: RemoteAccessStatus
  /** Whether the remote already has the workspace's branch (it's been pushed). */
  hasBranch: boolean
  /** Set when this repo is only reachable through the temporary agent — pass it on as `AddRepoOptions.sshAuthSock`. */
  sshAuthSock?: string
}

export interface KeyUnlockRequest {
  keyPath: string
  /** The repos (as given) that reach the same host and are still waiting on a key. */
  sources: string[]
}

export interface PrepareRemoteAccessOptions {
  /**
   * Called right before `ssh-add` asks for `keyPath`'s passphrase on the
   * terminal, so the frontend can say what it's for. Omit it when nobody
   * can answer (no TTY, the MCP server): nothing is asked, and a repo
   * whose key isn't loaded stays `'auth-failed'`.
   */
  onUnlock?: (request: KeyUnlockRequest) => void
}

export interface RemoteAccessSession {
  repos: RepoRemoteAccess[]
  /** Stops the temporary agent, if one was started. Call once every add is done, success or not. */
  close(): Promise<void>
}

interface Pending {
  index: number
  url: string
  target: SshTarget
}

/**
 * Checks every repo about to be added to a workspace against its remote,
 * *before* anything runs concurrently, and unlocks any SSH key that's
 * missing — see docs/plans/0005-ssh-key-unlock.md. Each repo is first
 * tried with the user's own ssh-agent. For any that fail on
 * authentication, with `onUnlock` given, spork starts a temporary agent
 * and asks for one locked key at a time (`ssh-add` asks, never spork),
 * re-checking the still-failing repos after each, until they all pass or
 * no keys are left to try. A repo that passes only through the temporary
 * agent gets its socket in `sshAuthSock`; ssh-agents can't chain, so each
 * repo uses exactly one. Never on Windows, where `ssh-agent -D -a`
 * doesn't work.
 *
 * Doubles as the check for an already-pushed workspace branch
 * (`hasBranch`), since it's the same `ls-remote` either way.
 */
export async function prepareRemoteAccess(
  ctx: { reposRoot: string; repoRegistryPath: string },
  workspaceDir: string,
  sources: readonly string[],
  branch: string,
  options: PrepareRemoteAccessOptions = {},
): Promise<RemoteAccessSession> {
  const urls = await Promise.all(
    sources.map((source) =>
      resolveScopedRepoAlias(ctx.reposRoot, localRepoRegistryPath(workspaceDir), ctx.repoRegistryPath, source),
    ),
  )
  const probes = await Promise.all(urls.map((url) => probeRemote(url, branch)))
  const repos: RepoRemoteAccess[] = sources.map((source, index) => ({ source, ...(probes[index] as RemoteProbe) }))

  const pending = repos.flatMap((repo, index): Pending[] => {
    const target = parseSshTarget(urls[index] as string)
    return repo.status === 'auth-failed' && target ? [{ index, url: urls[index] as string, target }] : []
  })
  if (!options.onUnlock || pending.length === 0 || process.platform === 'win32') {
    return { repos, close: async () => {} }
  }

  const agent = await unlockMissingKeys(repos, pending, branch, options.onUnlock)
  return { repos, close: async () => agent?.stop() }
}

/**
 * The ask-and-recheck loop behind `prepareRemoteAccess`. Keys are tried in
 * the order ssh would try them for the first still-failing repo's host;
 * once a host has no untried keys left, its repos stay `'auth-failed'`.
 * Returns the agent it started, if any, for the caller to stop. If the
 * agent can't start at all, nothing is asked and nothing changes.
 */
async function unlockMissingKeys(
  repos: RepoRemoteAccess[],
  initial: Pending[],
  branch: string,
  onUnlock: (request: KeyUnlockRequest) => void,
): Promise<TemporaryAgent | undefined> {
  let pending = initial
  const tried = new Set<string>()
  let agent: TemporaryAgent | undefined
  try {
    while (pending.length > 0) {
      const next = pending[0] as Pending
      const host = sshTargetKey(next.target)
      const sameHost = pending.filter((p) => sshTargetKey(p.target) === host)
      const key = (await findLockedKeys(next.target)).find((file) => !tried.has(file))
      if (!key) {
        pending = pending.filter((p) => !sameHost.includes(p))
        continue
      }
      tried.add(key)
      agent ??= await startTemporaryAgent()

      onUnlock({ keyPath: key, sources: sameHost.map((p) => repos[p.index]?.source as string) })
      if (!(await agent.unlock(key))) continue
      pending = await recheck(repos, pending, branch, agent.socket)
    }
  } catch {
    // Most likely ssh-agent itself is missing; leave the repos as they were for the real add to report.
  }
  return agent
}

/** Re-probes `pending` through the temporary agent, recording each repo that now gets in. Returns the ones still failing. */
async function recheck(repos: RepoRemoteAccess[], pending: Pending[], branch: string, sshAuthSock: string): Promise<Pending[]> {
  const probes = await Promise.all(pending.map((p) => probeRemote(p.url, branch, { sshAuthSock })))
  return pending.filter((p, i) => {
    const probe = probes[i] as RemoteProbe
    if (probe.status !== 'ok') return true
    repos[p.index] = { ...(repos[p.index] as RepoRemoteAccess), ...probe, sshAuthSock }
    return false
  })
}
