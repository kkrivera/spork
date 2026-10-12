/** Extracts a repo's short name from a source URL/path, e.g. "widgets" from "git@github.com:acme/widgets.git". */
export function repoShortName(source: string): string {
  const name = source
    .replace(/\.git$/, '')
    .split(/[/:]/)
    .filter(Boolean)
    .pop()

  return name ?? 'repo'
}

const SCHEME_URL = /^[a-zA-Z][\w+.-]*:\/\/[^/]+\/(.+)$/
const SCP_LIKE = /^[\w.-]+@[\w.-]+:(.+)$/

/**
 * Extracts the owner/org segment from a source URL, e.g. "acme" from
 * "git@github.com:acme/widgets.git" or "https://github.com/acme/widgets.git".
 * Returns null for anything that isn't shaped like a remote URL (a bare
 * local path has no "owner" to extract — the immediate parent directory
 * isn't one, e.g. every repo in a scanned ~/code folder would wrongly
 * "share" an owner of "code").
 */
export function repoOwner(source: string): string | null {
  const withoutGit = source.replace(/\.git$/, '')
  const path = SCHEME_URL.exec(withoutGit)?.[1] ?? SCP_LIKE.exec(withoutGit)?.[1]
  if (!path) return null

  const segments = path.split('/').filter(Boolean)
  return segments.length >= 2 ? (segments.at(-2) as string) : null
}
