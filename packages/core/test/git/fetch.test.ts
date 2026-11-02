import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../src/git/exec.js', () => ({
  execGit: vi.fn(),
}))

const { execGit } = await import('../../src/git/exec.js')
const { configureFetchRefspec, fetchRef } = await import('../../src/git/fetch.js')

const execGitMock = vi.mocked(execGit)

const CACHE = '/cache/foo-bar'
const SHA = 'a'.repeat(40)

interface FakeGit {
  head?: string
  /** Lines `ls-remote` prints, as `name` only — the sha column is filled in. */
  remoteRefs?: string[]
  /** Branch names currently checked out in some worktree. */
  checkedOut?: string[]
  hasCommit?: boolean
}

/** Answers each git subcommand `fetchRef` runs from a small fake cache/remote. */
function fakeGit({ head = 'refs/heads/main', remoteRefs = [], checkedOut = [], hasCommit = false }: FakeGit = {}): void {
  execGitMock.mockImplementation(async (args) => {
    const stdout = (() => {
      switch (args[0]) {
        case 'symbolic-ref':
          return `${head}\n`
        case 'ls-remote':
          return remoteRefs.map((name) => `${SHA}\t${name}\n`).join('')
        case 'worktree':
          return [`worktree ${CACHE}\nbare\n`, ...checkedOut.map((b) => `worktree /ws/${b}\nHEAD ${SHA}\nbranch refs/heads/${b}\n`)].join('\n')
        case 'cat-file':
          if (!hasCommit) throw new Error('missing')
          return ''
        default:
          return ''
      }
    })()
    return { stdout, stderr: '' }
  })
}

function fetchCall(): readonly string[] | undefined {
  return execGitMock.mock.calls.find((call) => call[0][0] === 'fetch')?.[0]
}

beforeEach(() => {
  execGitMock.mockReset()
})

describe('configureFetchRefspec', () => {
  it('maps remote branches into refs/remotes/origin/*, never local refs/heads/*', async () => {
    execGitMock.mockResolvedValue({ stdout: '', stderr: '' })

    await configureFetchRefspec(CACHE)

    expect(execGitMock).toHaveBeenCalledWith(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'], { cwd: CACHE })
  })
})

describe('fetchRef — default branch', () => {
  it("fetches only the cache's default branch for HEAD", async () => {
    fakeGit({ head: 'refs/heads/trunk' })

    await fetchRef(CACHE)

    expect(fetchCall()).toEqual(['fetch', '--no-tags', 'origin', '+refs/heads/trunk:refs/heads/trunk'])
  })

  it('re-asserts the standard refspec before fetching, self-healing older caches', async () => {
    fakeGit()

    await fetchRef(CACHE)

    const configIndex = execGitMock.mock.calls.findIndex((call) => call[0][0] === 'config')
    const fetchIndex = execGitMock.mock.calls.findIndex((call) => call[0][0] === 'fetch')
    expect(execGitMock.mock.calls[configIndex]?.[0]).toEqual(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'])
    expect(configIndex).toBeLessThan(fetchIndex)
  })

  it('never fetches a pushed workspace branch — only the requested ref', async () => {
    fakeGit({ checkedOut: ['someone/other-workspace'] })

    await fetchRef(CACHE)

    expect(fetchCall()).toEqual(['fetch', '--no-tags', 'origin', '+refs/heads/main:refs/heads/main'])
  })

})

describe('fetchRef — explicit refs', () => {
  it('fetches a named branch the remote has', async () => {
    fakeGit({ remoteRefs: ['refs/heads/release/2.x'] })

    await fetchRef(CACHE, 'release/2.x')

    expect(execGitMock).toHaveBeenCalledWith(['ls-remote', 'origin', 'refs/heads/release/2.x', 'refs/tags/release/2.x'], { cwd: CACHE })
    expect(fetchCall()).toEqual(['fetch', '--no-tags', 'origin', '+refs/heads/release/2.x:refs/heads/release/2.x'])
  })

  it('fetches a tag the remote has, ignoring the peeled ^{} entry and non-exact pattern matches', async () => {
    fakeGit({ remoteRefs: ['refs/tags/v1.2.0', 'refs/tags/v1.2.0^{}', 'refs/heads/feature/refs/tags/v1.2.0'] })

    await fetchRef(CACHE, 'v1.2.0')

    expect(fetchCall()).toEqual(['fetch', '--no-tags', 'origin', '+refs/tags/v1.2.0:refs/tags/v1.2.0'])
  })

  it('uses a full ref name as-is', async () => {
    fakeGit({ remoteRefs: ['refs/heads/main'] })

    await fetchRef(CACHE, 'refs/heads/main')

    expect(execGitMock).toHaveBeenCalledWith(['ls-remote', 'origin', 'refs/heads/main'], { cwd: CACHE })
    expect(fetchCall()).toEqual(['fetch', '--no-tags', 'origin', '+refs/heads/main:refs/heads/main'])
  })
})

describe('fetchRef — checked-out branches', () => {
  it("skips a requested branch that's checked out in a worktree, whose local copy is authoritative", async () => {
    fakeGit({ remoteRefs: ['refs/heads/me/feature'], checkedOut: ['me/feature'] })

    await fetchRef(CACHE, 'me/feature')

    expect(fetchCall()).toBeUndefined()
  })

  it("skips the default branch too if it's checked out somewhere", async () => {
    fakeGit({ checkedOut: ['main'] })

    await fetchRef(CACHE)

    expect(fetchCall()).toBeUndefined()
  })
})

describe('fetchRef — refs the remote may not have', () => {
  it("fetches nothing for a ref the remote doesn't have, leaving it to resolve locally", async () => {
    fakeGit({ remoteRefs: [] })

    await fetchRef(CACHE, 'local-only')

    expect(fetchCall()).toBeUndefined()
  })

  it('fetches a full sha the cache lacks', async () => {
    fakeGit({ hasCommit: false })

    await fetchRef(CACHE, SHA)

    expect(fetchCall()).toEqual(['fetch', '--no-tags', 'origin', SHA])
  })

  it('skips the network entirely for a full sha the cache already has', async () => {
    fakeGit({ hasCommit: true })

    await fetchRef(CACHE, SHA)

    expect(fetchCall()).toBeUndefined()
    expect(execGitMock.mock.calls.some((call) => call[0][0] === 'ls-remote')).toBe(false)
  })

  it('forwards allowPrompts to the network calls only', async () => {
    fakeGit({ remoteRefs: ['refs/heads/dev'] })

    await fetchRef(CACHE, 'dev', { allowPrompts: true })

    for (const [args, options] of execGitMock.mock.calls) {
      const isNetwork = args[0] === 'ls-remote' || args[0] === 'fetch'
      expect(options).toEqual(isNetwork ? { cwd: CACHE, allowPrompts: true } : { cwd: CACHE })
    }
  })
})
