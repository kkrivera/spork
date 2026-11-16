import {
  branchConflictError,
  defaultAlias,
  prepareRemoteAccess,
  type KeyUnlockRequest,
  type RemoteAccessSession,
} from '@spork/core'
import { workspaceContext, type AppContext } from '../../context.js'
import { tildify } from '../../output/paths.js'
import { resolveFetchRemoteBranch } from './remoteBranchPrompt.js'

/** Prints why a key's passphrase is about to be asked for — see `keyUnlockNotifier`. */
export type KeyUnlockNotifier = (request: KeyUnlockRequest) => void

export interface RemoteSetupOptions {
  /** `--from-remote-branch`/`--no-from-remote-branch`; unset means ask (see `remoteBranchPrompt.ts`). */
  fromRemoteBranch?: boolean
  /** Not a flag: set by `register*` from `keyUnlockNotifier`. Unset means never ask for a passphrase. */
  onUnlockKey?: KeyUnlockNotifier
}

/** What a batch of adds needs from `checkRemotes`'s result — see `planRemotes`. */
export interface RemotePlan {
  /** Sources (as given) to start from the workspace's already-pushed branch — see `RemoteBranchDecision.fetchFrom`. */
  fetchRemoteBranchFrom: ReadonlySet<string>
  /** See `RemoteBranchDecision.notice`. */
  remoteBranchNotice?: string
  /** Source (as given) → agent socket, for each repo reachable only through spork's temporary agent. */
  sshAuthSocks: ReadonlyMap<string, string>
}

export interface WorkspaceRemotes extends RemotePlan {
  /** Stops the temporary agent. Call once every add has finished, in a `finally`. */
  close(): Promise<void>
}

/**
 * One `ls-remote` per repo (`@spork/core`'s `prepareRemoteAccess`),
 * unlocking any SSH key that isn't loaded (asked for on the terminal by
 * `ssh-add`, only when `onUnlockKey` is set). The caller must `close()`
 * the result once its adds are done, so the key is forgotten — see
 * docs/plans/0005-ssh-key-unlock.md. `create` checks every registered repo
 * this way before asking which to add (`createFromPushedBranch.ts`), then
 * plans each batch it adds from the same result.
 */
export function checkRemotes(
  ctx: AppContext,
  workspaceDir: string,
  branch: string,
  sources: readonly string[],
  options: Pick<RemoteSetupOptions, 'onUnlockKey'>,
): Promise<RemoteAccessSession> {
  return prepareRemoteAccess(workspaceContext(ctx), workspaceDir, sources, branch, { onUnlock: options.onUnlockKey })
}

/**
 * Settles what adding `sources` (some or all of what `session` checked)
 * needs: stops with a clear error if the workspace's name can't be a
 * branch in one of them (`branchConflictError`: `test` when it has
 * `test/a`), then decides which start from an already-pushed workspace
 * branch (`remoteBranchPrompt.ts`).
 */
export async function planRemotes(
  session: RemoteAccessSession,
  branch: string,
  sources: readonly string[],
  fromRemoteBranch: boolean | undefined,
): Promise<RemotePlan> {
  const wanted = new Set(sources)
  const repos = session.repos.filter((repo) => wanted.has(repo.source))
  const conflict = branchConflictError(branch, repos)
  if (conflict) throw conflict
  const decision = await resolveFetchRemoteBranch(repos, branch, fromRemoteBranch)
  const sshAuthSocks = new Map(repos.flatMap((repo) => (repo.sshAuthSock ? [[repo.source, repo.sshAuthSock] as const] : [])))
  return { fetchRemoteBranchFrom: new Set(decision.fetchFrom), remoteBranchNotice: decision.notice, sshAuthSocks }
}

/**
 * `checkRemotes` then `planRemotes` for exactly the repos about to be
 * added, before the live dashboard starts (nothing can prompt while it's
 * drawing). Closes the check itself if planning fails.
 */
export async function prepareWorkspaceRemotes(
  ctx: AppContext,
  workspaceDir: string,
  branch: string,
  sources: readonly string[],
  options: RemoteSetupOptions,
): Promise<WorkspaceRemotes> {
  const session = await checkRemotes(ctx, workspaceDir, branch, sources, options)
  try {
    return { ...(await planRemotes(session, branch, sources, options.fromRemoteBranch)), close: session.close }
  } catch (error) {
    await session.close()
    throw error
  }
}

/**
 * The `onUnlockKey` a `register*` passes in: says which repos need which
 * key, and that spork won't keep it, right before `ssh-add` asks for the
 * passphrase. Undefined when stdin or stdout isn't a terminal, so nothing
 * is ever asked in CI, a pipe, or a script.
 */
export function keyUnlockNotifier(ctx: AppContext): KeyUnlockNotifier | undefined {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) return undefined
  return ({ keyPath, sources }) => {
    const repos = sources.map((source) => defaultAlias(source)).join(', ')
    console.log(`${repos} ${sources.length === 1 ? 'needs' : 'need'} the SSH key ${tildify(keyPath)}, which isn't loaded in your ssh-agent.`)
    console.log(ctx.ui.color.dim('spork keeps it only until this command finishes. Press Enter with no passphrase to skip it.'))
  }
}
