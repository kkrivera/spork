import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

const { execFileSync } = await import('node:child_process')
const { parseBase, getChangedFiles, nearestReadme, findViolations, main } = await import('../check.js')

describe('parseBase', () => {
  it('reads the value after --base', () => {
    expect(parseBase(['--base', 'origin/main'])).toBe('origin/main')
  })

  it('defaults to "main" when --base is absent', () => {
    expect(parseBase([])).toBe('main')
  })

  it('defaults to "main" when --base has no following value', () => {
    expect(parseBase(['--base'])).toBe('main')
  })
})

describe('getChangedFiles', () => {
  it('parses non-empty trimmed lines from the git diff', () => {
    vi.mocked(execFileSync).mockReturnValue('packages/core/src/a.ts\n\npackages/cli/src/b.ts\n')

    expect(getChangedFiles('main')).toEqual(['packages/core/src/a.ts', 'packages/cli/src/b.ts'])
    expect(execFileSync).toHaveBeenCalledWith('git', ['diff', '--name-only', 'main...HEAD'], { encoding: 'utf8' })
  })
})

let repoRoot: string

beforeEach(async () => {
  repoRoot = await mkdtemp(path.join(os.tmpdir(), 'spork-readme-sync-'))
  await mkdir(path.join(repoRoot, 'packages', 'core', 'src', 'workspace'), { recursive: true })
  await writeFile(path.join(repoRoot, 'packages', 'core', 'README.md'), '# core', 'utf8')
  await mkdir(path.join(repoRoot, 'docs', 'plans'), { recursive: true })
  await writeFile(path.join(repoRoot, 'README.md'), '# spork', 'utf8')
})

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true })
})

describe('nearestReadme', () => {
  it('finds a README.md in an ancestor directory within the same scoped root', () => {
    const readme = nearestReadme('packages/core/src/workspace/workspace.ts', repoRoot)

    expect(readme).toBe(path.join('packages', 'core', 'README.md'))
  })

  it('returns null for a file outside packages/ or tools/', () => {
    expect(nearestReadme('docs/plans/0001-x.md', repoRoot)).toBeNull()
  })

  it('never walks up past the scoped root to the repo-level README', () => {
    expect(nearestReadme('packages/orphan/src/index.ts', repoRoot)).toBeNull()
  })
})

describe('main', () => {
  afterEach(() => {
    process.exitCode = 0
  })

  it('prints OK and leaves the exit code alone when nothing is missing', () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(repoRoot)
    vi.mocked(execFileSync).mockReturnValue('packages/core/src/a.ts\npackages/core/README.md\n')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    main()

    expect(logSpy).toHaveBeenCalledWith('readme-sync: OK')
    expect(process.exitCode).toBeFalsy()
    cwdSpy.mockRestore()
    logSpy.mockRestore()
  })

  it('prints each violation and sets a failing exit code', () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(repoRoot)
    vi.mocked(execFileSync).mockReturnValue('packages/core/src/a.ts\n')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    main()

    expect(errorSpy.mock.calls.flat().join('\n')).toContain(path.join('packages', 'core', 'README.md'))
    expect(process.exitCode).toBe(1)
    cwdSpy.mockRestore()
    errorSpy.mockRestore()
  })
})

describe('findViolations', () => {
  it('flags a module whose source changed without its README', () => {
    const violations = findViolations(['packages/core/src/workspace/workspace.ts'], repoRoot)

    expect(violations).toEqual([
      { readme: path.join('packages', 'core', 'README.md'), exampleChangedFile: 'packages/core/src/workspace/workspace.ts' },
    ])
  })

  it('does not flag a module whose README was also changed', () => {
    const violations = findViolations(
      ['packages/core/src/workspace/workspace.ts', 'packages/core/README.md'],
      repoRoot,
    )

    expect(violations).toEqual([])
  })

  it('reports each violated module only once, regardless of how many of its files changed', () => {
    const violations = findViolations(
      ['packages/core/src/workspace/workspace.ts', 'packages/core/src/git/exec.ts'],
      repoRoot,
    )

    expect(violations).toHaveLength(1)
  })

  it('ignores changes outside packages/ and tools/', () => {
    expect(findViolations(['docs/plans/0001-x.md', 'README.md'], repoRoot)).toEqual([])
  })
})
