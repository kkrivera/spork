#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type Bump = 'major' | 'minor' | 'patch'

export function nextVersion(current: string, bump: Bump): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current)
  if (!match) throw new Error(`"${current}" is not a plain major.minor.patch version`)

  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])

  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
  }
}

export function parseBump(argv: readonly string[]): Bump {
  const flagIndex = argv.indexOf('--bump')
  const value = flagIndex !== -1 ? argv[flagIndex + 1] : undefined
  if (value !== 'major' && value !== 'minor' && value !== 'patch') {
    throw new Error('Usage: bump-version.ts --bump <major|minor|patch>')
  }
  return value
}

export async function listWorkspacePackageJsonPaths(repoRoot: string): Promise<string[]> {
  const packagesDir = path.join(repoRoot, 'packages')
  const entries = await readdir(packagesDir, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(packagesDir, entry.name, 'package.json'))
}

export async function readVersion(packageJsonPath: string): Promise<string> {
  const data = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version: string }
  return data.version
}

export async function writeVersion(packageJsonPath: string, version: string): Promise<void> {
  const data = JSON.parse(await readFile(packageJsonPath, 'utf8')) as Record<string, unknown>
  data.version = version
  await writeFile(packageJsonPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

/** Replaces a single hardcoded version-string literal matched by `pattern` with `replacement`. */
export async function patchLiteral(filePath: string, pattern: RegExp, replacement: string): Promise<void> {
  const source = await readFile(filePath, 'utf8')
  if (!pattern.test(source)) throw new Error(`Pattern ${pattern} not found in ${filePath}`)
  await writeFile(filePath, source.replace(pattern, replacement), 'utf8')
}

/**
 * Bumps the version in lockstep across every workspace package.json (plus
 * the root one) and the two hardcoded version-string literals that can't be
 * read from package.json at runtime inside a packaged SEA binary:
 * `@spork/cli`'s `.version(...)` and `@spork/mcp`'s `McpServer({ version })`.
 */
export async function bumpVersion(repoRoot: string, bump: Bump): Promise<string> {
  const rootPackageJsonPath = path.join(repoRoot, 'package.json')
  const version = nextVersion(await readVersion(rootPackageJsonPath), bump)

  const packagePaths = [rootPackageJsonPath, ...(await listWorkspacePackageJsonPaths(repoRoot))]
  await Promise.all(packagePaths.map((packageJsonPath) => writeVersion(packageJsonPath, version)))

  await patchLiteral(path.join(repoRoot, 'packages/cli/src/index.ts'), /\.version\('[^']*'\)/, `.version('${version}')`)
  await patchLiteral(path.join(repoRoot, 'packages/mcp/src/index.ts'), /version: '[^']*'/, `version: '${version}'`)

  return version
}

export async function main(): Promise<void> {
  const bump = parseBump(process.argv.slice(2))
  const version = await bumpVersion(process.cwd(), bump)
  console.log(version)
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
