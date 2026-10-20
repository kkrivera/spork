import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  bumpVersion,
  listWorkspacePackageJsonPaths,
  nextVersion,
  parseBump,
  patchLiteral,
  readVersion,
  writeVersion,
} from '../bump-version.js'

describe('nextVersion', () => {
  it('bumps patch', () => {
    expect(nextVersion('1.2.3', 'patch')).toBe('1.2.4')
  })

  it('bumps minor and resets patch', () => {
    expect(nextVersion('1.2.3', 'minor')).toBe('1.3.0')
  })

  it('bumps major and resets minor/patch', () => {
    expect(nextVersion('1.2.3', 'major')).toBe('2.0.0')
  })

  it('rejects a non plain major.minor.patch version', () => {
    expect(() => nextVersion('1.2.3-beta.1', 'patch')).toThrow('not a plain major.minor.patch version')
  })
})

describe('parseBump', () => {
  it('reads the value after --bump', () => {
    expect(parseBump(['--bump', 'minor'])).toBe('minor')
  })

  it('rejects a missing --bump flag', () => {
    expect(() => parseBump([])).toThrow('Usage:')
  })

  it('rejects an unrecognized bump value', () => {
    expect(() => parseBump(['--bump', 'nope'])).toThrow('Usage:')
  })
})

let repoRoot: string

beforeEach(async () => {
  repoRoot = await mkdtemp(path.join(os.tmpdir(), 'spork-release-'))
  await writeFile(path.join(repoRoot, 'package.json'), JSON.stringify({ name: 'spork', version: '0.1.0' }), 'utf8')

  await mkdir(path.join(repoRoot, 'packages', 'cli', 'src'), { recursive: true })
  await writeFile(
    path.join(repoRoot, 'packages', 'cli', 'package.json'),
    JSON.stringify({ name: '@spork/cli', version: '0.1.0' }),
    'utf8',
  )
  await writeFile(path.join(repoRoot, 'packages', 'cli', 'src', 'index.ts'), "program.version('0.1.0')\n", 'utf8')

  await mkdir(path.join(repoRoot, 'packages', 'mcp', 'src'), { recursive: true })
  await writeFile(
    path.join(repoRoot, 'packages', 'mcp', 'package.json'),
    JSON.stringify({ name: '@spork/mcp', version: '0.1.0' }),
    'utf8',
  )
  await writeFile(
    path.join(repoRoot, 'packages', 'mcp', 'src', 'index.ts'),
    "new McpServer({ name: 'spork', version: '0.1.0' })\n",
    'utf8',
  )
})

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true })
})

describe('listWorkspacePackageJsonPaths', () => {
  it('lists every packages/*/package.json', async () => {
    const paths = await listWorkspacePackageJsonPaths(repoRoot)

    expect(paths.sort()).toEqual(
      [path.join(repoRoot, 'packages', 'cli', 'package.json'), path.join(repoRoot, 'packages', 'mcp', 'package.json')].sort(),
    )
  })
})

describe('readVersion / writeVersion', () => {
  it('round-trips a version while preserving other fields', async () => {
    const pkgPath = path.join(repoRoot, 'package.json')

    await writeVersion(pkgPath, '2.0.0')

    expect(await readVersion(pkgPath)).toBe('2.0.0')
    expect(JSON.parse(await readFile(pkgPath, 'utf8'))).toMatchObject({ name: 'spork', version: '2.0.0' })
  })
})

describe('patchLiteral', () => {
  it('replaces a matched literal', async () => {
    const filePath = path.join(repoRoot, 'packages', 'cli', 'src', 'index.ts')

    await patchLiteral(filePath, /program\.version\('[^']*'\)/, "program.version('2.0.0')")

    expect(await readFile(filePath, 'utf8')).toContain("program.version('2.0.0')")
  })

  it('throws when the pattern is not found', async () => {
    const filePath = path.join(repoRoot, 'packages', 'cli', 'src', 'index.ts')

    await expect(patchLiteral(filePath, /nope/, 'x')).rejects.toThrow('not found')
  })
})

describe('bumpVersion', () => {
  it('bumps the root, every workspace package, and both version literals in lockstep', async () => {
    const version = await bumpVersion(repoRoot, 'minor')

    expect(version).toBe('0.2.0')
    expect(await readVersion(path.join(repoRoot, 'package.json'))).toBe('0.2.0')
    expect(await readVersion(path.join(repoRoot, 'packages', 'cli', 'package.json'))).toBe('0.2.0')
    expect(await readVersion(path.join(repoRoot, 'packages', 'mcp', 'package.json'))).toBe('0.2.0')

    const cliSource = await readFile(path.join(repoRoot, 'packages', 'cli', 'src', 'index.ts'), 'utf8')
    expect(cliSource).toContain("program.version('0.2.0')")

    const mcpSource = await readFile(path.join(repoRoot, 'packages', 'mcp', 'src', 'index.ts'), 'utf8')
    expect(mcpSource).toContain("version: '0.2.0'")
  })
})
