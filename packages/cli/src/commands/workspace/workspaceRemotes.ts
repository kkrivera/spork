import os from 'node:os'
import { defaultAlias, prepareRemoteAccess, type KeyUnlockRequest } from '@spork/core'
import { workspaceContext, type AppContext } from '../../context.js'
import { resolveFetchRemoteBranch } from './remoteBranchPrompt.js'

/** Prints why a key's passphrase is about to be asked for — see `keyUnlockNotifier`. */
export type KeyUnlockNotifier = (request: KeyUnlockRequest) => void

export interface RemoteSetupOptions {
  /** `--from-remote-branch`/`--no-from-remote-branch`; unset means ask (see `remoteBranchPrompt.ts`). */
  fromRemoteBranch?: boolean
  /** Not a flag: set by `register*` from `keyUnlockNotifier`. Unset means never ask for a passphrase. */
  onUnlockKey?: KeyUnlockNotifier
}

export interface WorkspaceRemotes {
  fetchRemoteBranch: boolean
  /** See `RemoteBranchDecision.notice`. */
  remoteBranchNotice?: string
  /** Source (as given) → agent socket, for each repo reachable only through spork's temporary agent. */
  sshAuthSocks: ReadonlyMap<string, string>
  /** Stops the temporary agent. Call once every add has finished, in a `finally`. */
  close(): Promise<void>
}

/**
 * Everything `create`/`add-repo` need from the remotes before the live
 * dashboard starts, from one `ls-remote` per repo (`@spork/core`'s
 * `prepareRemoteAccess`): unlocking any SSH key that isn't loaded (asked
 * for on the terminal by `ssh-add`, only when `onUnlockKey` is set), then
 * whether to start from an already-pushed workspace branch. The caller
 * must `close()` the result once its adds are done, so the key is
 * forgotten — see docs/plans/0005-ssh-key-unlock.md.
 */
export async function prepareWorkspaceRemotes(
  ctx: AppContext,
  workspaceDir: string,
  branch: string,
  sources: readonly string[],
  options: RemoteSetupOptions,
): Promise<WorkspaceRemotes> {
  const session = await prepareRemoteAccess(workspaceContext(ctx), workspaceDir, sources, branch, {
    onUnlock: options.onUnlockKey,
  })
  try {
    const decision = await resolveFetchRemoteBranch(session.repos, branch, options.fromRemoteBranch)
    const sshAuthSocks = new Map(session.repos.flatMap((repo) => (repo.sshAuthSock ? [[repo.source, repo.sshAuthSock] as const] : [])))
    return { fetchRemoteBranch: decision.fetchRemoteBranch, remoteBranchNotice: decision.notice, sshAuthSocks, close: session.close }
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

function tildify(file: string): string {
  const home = os.homedir()
  return file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file
}
