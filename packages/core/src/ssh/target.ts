/** Where an SSH remote connects: what `ssh -G` needs to resolve the user's config for it. */
export interface SshTarget {
  /** As written in the source — may be a `~/.ssh/config` alias like `github-work`, not a real hostname. */
  host: string
  user?: string
  port?: number
}

const SSH_URL = /^(?:ssh|git\+ssh|ssh\+git):\/\/(?:([^@/]+)@)?(\[[^\]]+\]|[^:/]+)(?::(\d+))?\//
const SCP_LIKE = /^(?:([^@/:]+)@)?([^:/]+):/

/**
 * Parses an SSH remote — `ssh://[user@]host[:port]/path` or git's scp-like
 * `[user@]host:path` — or returns null for anything else (HTTPS, `file://`,
 * a local path). Follows git's own rule for telling scp-like syntax from a
 * path: there's a colon before any slash, and it isn't a Windows drive
 * letter (`C:\repo`).
 */
export function parseSshTarget(source: string): SshTarget | null {
  const url = SSH_URL.exec(source)
  if (url) return target(url[2] as string, url[1], url[3])
  if (source.includes('://')) return null

  const scp = SCP_LIKE.exec(source)
  if (!scp || (scp[2] as string).length < 2) return null
  return target(scp[2] as string, scp[1])
}

function target(host: string, user?: string, port?: string): SshTarget {
  return {
    host: host.replace(/^\[(.*)\]$/, '$1'),
    ...(user ? { user } : {}),
    ...(port ? { port: Number(port) } : {}),
  }
}

/** A stable key for grouping repos that reach the same host as the same user. */
export function sshTargetKey(target: SshTarget): string {
  return `${target.user ?? ''}@${target.host}:${target.port ?? ''}`
}
