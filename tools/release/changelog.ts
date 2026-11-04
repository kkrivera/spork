#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const RELEASES_URL = 'https://github.com/kkrivera/spork/releases'

export type Group = 'Added' | 'Changed' | 'Fixed' | 'Removed' | 'Documentation' | 'Maintenance'

/** The order groups appear in within a release's section. */
export const GROUP_ORDER: readonly Group[] = ['Added', 'Changed', 'Fixed', 'Removed', 'Documentation', 'Maintenance']

const HEADER = `# Changelog

What changed in each spork release, newest first. Install or upgrade with
\`brew upgrade spork\`, or download from the
[releases page](${RELEASES_URL}).
`

const ADDED_VERBS = new Set(['add', 'adds', 'introduce', 'support', 'offer', 'generate', 'allow', 'let', 'scaffold'])
const FIXED_VERBS = new Set(['fix', 'fixes'])
const REMOVED_VERBS = new Set(['remove', 'drop', 'delete'])
const DOCS_SCOPES = new Set(['docs', 'doc'])
const MAINTENANCE_SCOPES = new Set(['chore', 'test', 'tests', 'ci', 'build', 'eslint', 'vitest', 'gitignore', 'release'])

export function parseVersion(argv: readonly string[]): string {
  const flagIndex = argv.indexOf('--version')
  const value = flagIndex !== -1 ? argv[flagIndex + 1] : undefined
  if (!value || !/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error('Usage: changelog.ts --version <major.minor.patch>')
  }
  return value
}

/** The release bot's own commits: the version bump and the Homebrew formula update. */
export function isReleaseBotCommit(title: string): boolean {
  return /^chore\((release|homebrew)\):/.test(title)
}

/**
 * Splits a commit title into its `scope:` prefix (lowercased, parentheses
 * and a trailing `!` dropped, so `chore(x)`, `(chore)` and `feat!` all
 * reduce to their type) and the rest.
 */
export function splitTitle(title: string): { scope: string | null; rest: string } {
  const match = /^([^:\s][^:]{0,39}):\s+(.*)$/.exec(title)
  if (!match) return { scope: null, rest: title }
  const raw = (match[1] as string).toLowerCase().replace(/!$/, '')
  const scope = /^\((.*)\)$/.exec(raw)?.[1] ?? raw.replace(/\(.*\)$/, '')
  return { scope: scope || null, rest: match[2] as string }
}

/** Picks a commit's group from its scope, then from the verb it starts with. */
export function groupOf(title: string): Group {
  const { scope, rest } = splitTitle(title)
  if (scope && DOCS_SCOPES.has(scope)) return 'Documentation'
  if (scope && MAINTENANCE_SCOPES.has(scope)) return 'Maintenance'
  if (scope === 'feat') return 'Added'
  if (scope === 'fix') return 'Fixed'

  const verb = rest.split(/\s+/, 1)[0]?.toLowerCase() ?? ''
  if (ADDED_VERBS.has(verb)) return 'Added'
  if (FIXED_VERBS.has(verb)) return 'Fixed'
  if (REMOVED_VERBS.has(verb)) return 'Removed'
  return 'Changed'
}

/** Renders one release's `## [X.Y.Z] - date` section, commit titles grouped. */
export function renderSection(version: string, date: string, titles: readonly string[]): string {
  const lines = [`## [${version}] - ${date}`, '']
  const kept = titles.filter((title) => !isReleaseBotCommit(title))
  if (kept.length === 0) return [...lines, 'No changes.', ''].join('\n')

  for (const group of GROUP_ORDER) {
    const inGroup = kept.filter((title) => groupOf(title) === group)
    if (inGroup.length === 0) continue
    lines.push(`### ${group}`, '', ...inGroup.map((title) => `- ${title}`), '')
  }
  return lines.join('\n')
}

/**
 * Inserts `section` above the newest release in `changelog` (or creates
 * the file's header first), and its link definition above the others.
 */
export function insertSection(changelog: string, version: string, section: string): string {
  if (changelog.includes(`## [${version}]`)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`)
  }

  let result = changelog.trim() ? changelog : HEADER
  const firstSection = result.search(/^## \[/m)
  result =
    firstSection === -1
      ? `${result.trimEnd()}\n\n${section}`
      : `${result.slice(0, firstSection)}${section}\n${result.slice(firstSection)}`

  const link = `[${version}]: ${RELEASES_URL}/tag/v${version}`
  const firstLink = result.search(/^\[\d+\.\d+\.\d+\]: /m)
  return firstLink === -1
    ? `${result.trimEnd()}\n\n${link}\n`
    : `${result.slice(0, firstLink)}${link}\n${result.slice(firstLink)}`
}

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** The newest `vX.Y.Z` tag reachable from HEAD, or null before the first release. */
export function previousTag(repoRoot: string): string | null {
  try {
    return git(repoRoot, ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD']).trim() || null
  } catch {
    return null
  }
}

/** Commit titles since `since` (or all of history), oldest first. */
export function commitTitles(repoRoot: string, since: string | null): string[] {
  const range = since ? [`${since}..HEAD`] : ['HEAD']
  return git(repoRoot, ['log', '--reverse', '--no-merges', '--format=%s', ...range])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function readOrEmpty(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Adds `version`'s section to the repo's CHANGELOG.md, from the titles of
 * the commits since the previous release tag. Run before the release
 * commit is made, so HEAD is the last commit going into the release.
 */
export async function writeChangelog(repoRoot: string, version: string, date: string): Promise<string> {
  const titles = commitTitles(repoRoot, previousTag(repoRoot))
  const section = renderSection(version, date, titles)
  const changelogPath = path.join(repoRoot, 'CHANGELOG.md')
  await writeFile(changelogPath, insertSection(await readOrEmpty(changelogPath), version, section), 'utf8')
  return section
}

export async function main(): Promise<void> {
  const version = parseVersion(process.argv.slice(2))
  const section = await writeChangelog(process.cwd(), version, new Date().toISOString().slice(0, 10))
  console.log(section)
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
