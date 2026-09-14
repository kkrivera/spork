#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

/** The only directories where a per-module README.md is expected to stay in sync with its source. */
const SCOPED_ROOTS = ['packages', 'tools']

export function parseBase(argv: readonly string[]): string {
  const flagIndex = argv.indexOf('--base')
  return flagIndex !== -1 && argv[flagIndex + 1] ? (argv[flagIndex + 1] as string) : 'main'
}

export function getChangedFiles(base: string): string[] {
  const output = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function scopedRootOf(filePath: string): string | null {
  return SCOPED_ROOTS.find((root) => filePath === root || filePath.startsWith(`${root}/`)) ?? null
}

/**
 * Walks up from `filePath`'s directory, within its scoped root only, looking
 * for the nearest README.md — the module doc that should have changed
 * alongside it. Never escapes above `packages/`/`tools/` (so an incidental
 * root-level change isn't mistaken for needing a module README update).
 */
export function nearestReadme(filePath: string, repoRoot: string): string | null {
  const scopedRoot = scopedRootOf(filePath)
  if (!scopedRoot) return null

  const boundary = path.join(repoRoot, scopedRoot)
  let dir = path.dirname(path.join(repoRoot, filePath))

  while (dir === boundary || dir.startsWith(`${boundary}${path.sep}`)) {
    const candidate = path.join(dir, 'README.md')
    if (existsSync(candidate)) return path.relative(repoRoot, candidate)
    dir = path.dirname(dir)
  }

  return null
}

export interface Violation {
  readme: string
  exampleChangedFile: string
}

export function findViolations(changedFiles: readonly string[], repoRoot: string): Violation[] {
  const changedSet = new Set(changedFiles)
  const violations = new Map<string, string>()

  for (const file of changedFiles) {
    if (path.basename(file) === 'README.md') continue

    const readme = nearestReadme(file, repoRoot)
    if (!readme || changedSet.has(readme)) continue

    if (!violations.has(readme)) violations.set(readme, file)
  }

  return [...violations].map(([readme, exampleChangedFile]) => ({ readme, exampleChangedFile }))
}

export function main(): void {
  const base = parseBase(process.argv.slice(2))
  const violations = findViolations(getChangedFiles(base), process.cwd())

  if (violations.length === 0) {
    console.log('readme-sync: OK')
    return
  }

  console.error('The following modules changed without their README.md being updated:\n')
  for (const violation of violations) {
    console.error(`  - ${violation.readme} (e.g. ${violation.exampleChangedFile} changed)`)
  }
  console.error('\nUpdate the README (see .claude/skills/readme-sync) or include it in this diff if unchanged.')
  process.exitCode = 1
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`

if (isMainModule) {
  main()
}
