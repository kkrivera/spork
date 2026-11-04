import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commitTitles,
  groupOf,
  insertSection,
  isReleaseBotCommit,
  parseVersion,
  previousTag,
  renderSection,
  splitTitle,
  writeChangelog,
} from '../changelog.js'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

const exec = vi.mocked(execFileSync)

describe('parseVersion', () => {
  it('reads the value after --version', () => {
    expect(parseVersion(['--version', '1.3.0'])).toBe('1.3.0')
  })

  it('rejects a missing or malformed version', () => {
    expect(() => parseVersion([])).toThrow('Usage:')
    expect(() => parseVersion(['--version', 'v1.3.0'])).toThrow('Usage:')
  })
})

describe('isReleaseBotCommit', () => {
  it('matches the bump and Homebrew commits only', () => {
    expect(isReleaseBotCommit('chore(release): bump version to v1.2.0')).toBe(true)
    expect(isReleaseBotCommit('chore(homebrew): update formula to v1.2.0')).toBe(true)
    expect(isReleaseBotCommit('chore: tidy up')).toBe(false)
  })
})

describe('splitTitle', () => {
  it('splits off a scope, reducing it to its type', () => {
    expect(splitTitle('cli: add a flag')).toEqual({ scope: 'cli', rest: 'add a flag' })
    expect(splitTitle('chore(deps): bump x')).toEqual({ scope: 'chore', rest: 'bump x' })
    expect(splitTitle('(chore): backfill')).toEqual({ scope: 'chore', rest: 'backfill' })
    expect(splitTitle('feat!: break it')).toEqual({ scope: 'feat', rest: 'break it' })
    expect(splitTitle('workspace create: offer it')).toEqual({ scope: 'workspace create', rest: 'offer it' })
  })

  it('leaves a title without a scope whole', () => {
    expect(splitTitle('Add Homebrew distribution')).toEqual({ scope: null, rest: 'Add Homebrew distribution' })
    expect(splitTitle('Add core git wrapper: bare clone')).toEqual({ scope: null, rest: 'Add core git wrapper: bare clone' })
    expect(splitTitle('remove: remove workspaces')).toEqual({ scope: 'remove', rest: 'remove workspaces' })
  })
})

describe('groupOf', () => {
  it.each([
    ['docs: plan the thing', 'Documentation'],
    ['chore: tidy up', 'Maintenance'],
    ['test: check the version', 'Maintenance'],
    ['feat: something new', 'Added'],
    ['fix: something broken', 'Fixed'],
    ['core: add an ssh module', 'Added'],
    ['Add Homebrew distribution', 'Added'],
    ['core: fix lost manifest entries', 'Fixed'],
    ['cli: drop the old flag', 'Removed'],
    ['cli: stop before creating a workspace', 'Changed'],
    ['Add core git wrapper: bare clone', 'Added'],
  ])('%s → %s', (title, group) => {
    expect(groupOf(title)).toBe(group)
  })
})

describe('renderSection', () => {
  it('groups titles in a fixed order and leaves out the release bot', () => {
    const section = renderSection('1.3.0', '2026-11-04', [
      'docs: plan it',
      'cli: fix a crash',
      'chore(release): bump version to v1.2.0',
      'core: add a module',
    ])

    expect(section).toBe(
      [
        '## [1.3.0] - 2026-11-04',
        '',
        '### Added',
        '',
        '- core: add a module',
        '',
        '### Fixed',
        '',
        '- cli: fix a crash',
        '',
        '### Documentation',
        '',
        '- docs: plan it',
        '',
      ].join('\n'),
    )
  })

  it('says so when there is nothing to list', () => {
    expect(renderSection('1.3.0', '2026-11-04', ['chore(release): bump version to v1.2.0'])).toBe(
      '## [1.3.0] - 2026-11-04\n\nNo changes.\n',
    )
  })
})

const SECTION = '## [1.3.0] - 2026-11-04\n\nNo changes.\n'
const EXISTING = '# Changelog\n\nIntro.\n\n## [1.2.0] - 2026-11-02\n\n- old\n\n[1.2.0]: https://example/v1.2.0\n'

describe('insertSection', () => {
  it('puts the section and its link above the previous release', () => {
    expect(insertSection(EXISTING, '1.3.0', SECTION)).toBe(
      '# Changelog\n\nIntro.\n\n' +
        `${SECTION}\n` +
        '## [1.2.0] - 2026-11-02\n\n- old\n\n' +
        '[1.3.0]: https://github.com/kkrivera/spork/releases/tag/v1.3.0\n' +
        '[1.2.0]: https://example/v1.2.0\n',
    )
  })

  it('starts the file with a header when it is empty', () => {
    const result = insertSection('', '1.3.0', SECTION)

    expect(result.startsWith('# Changelog\n')).toBe(true)
    expect(result).toContain(`\n\n${SECTION}`)
    expect(result.endsWith('\n\n[1.3.0]: https://github.com/kkrivera/spork/releases/tag/v1.3.0\n')).toBe(true)
  })

  it('refuses a version that already has a section', () => {
    expect(() => insertSection(EXISTING, '1.2.0', SECTION)).toThrow('already has a section for 1.2.0')
  })
})

describe('previousTag', () => {
  beforeEach(() => exec.mockReset())

  it('returns the newest release tag reachable from HEAD', () => {
    exec.mockReturnValue('v1.2.0\n')

    expect(previousTag('/repo')).toBe('v1.2.0')
    expect(exec).toHaveBeenCalledWith(
      'git',
      ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD'],
      expect.objectContaining({ cwd: '/repo' }),
    )
  })

  it('returns null before the first release', () => {
    exec.mockImplementationOnce(() => {
      throw new Error('fatal: No names found')
    })

    expect(previousTag('/repo')).toBeNull()
  })
})

describe('commitTitles', () => {
  beforeEach(() => exec.mockReset())

  it('reads the titles since a tag, oldest first', () => {
    exec.mockReturnValue('first\n\nsecond\n')

    expect(commitTitles('/repo', 'v1.2.0')).toEqual(['first', 'second'])
    expect(exec).toHaveBeenCalledWith(
      'git',
      ['log', '--reverse', '--no-merges', '--format=%s', 'v1.2.0..HEAD'],
      expect.anything(),
    )
  })

  it('reads all of history without a tag', () => {
    exec.mockReturnValue('')

    commitTitles('/repo', null)

    expect(exec.mock.calls[0]?.[1]).toEqual(['log', '--reverse', '--no-merges', '--format=%s', 'HEAD'])
  })
})

describe('writeChangelog', () => {
  let repoRoot: string

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(os.tmpdir(), 'spork-changelog-'))
    exec.mockReset()
    exec.mockImplementation((_cmd, args) => ((args as string[])[0] === 'describe' ? 'v1.2.0\n' : 'cli: add a flag\n'))
  })

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true })
  })

  it('adds the release to an existing CHANGELOG.md', async () => {
    await writeFile(path.join(repoRoot, 'CHANGELOG.md'), EXISTING, 'utf8')

    const section = await writeChangelog(repoRoot, '1.3.0', '2026-11-04')

    expect(section).toContain('- cli: add a flag')
    const written = await readFile(path.join(repoRoot, 'CHANGELOG.md'), 'utf8')
    expect(written.indexOf('## [1.3.0]')).toBeLessThan(written.indexOf('## [1.2.0]'))
  })

  it('creates CHANGELOG.md when there is none', async () => {
    await writeChangelog(repoRoot, '1.3.0', '2026-11-04')

    expect(await readFile(path.join(repoRoot, 'CHANGELOG.md'), 'utf8')).toContain('## [1.3.0] - 2026-11-04')
  })
})
