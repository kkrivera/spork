/** Extracts a repo's short name from a source URL/path, e.g. "widgets" from "git@github.com:acme/widgets.git". */
export function repoShortName(source: string): string {
  const name = source
    .replace(/\.git$/, '')
    .split(/[/:]/)
    .filter(Boolean)
    .pop()

  return name ?? 'repo'
}
