import { describe, expect, it } from 'vitest'
import { parseSshTarget, sshTargetKey } from '../../src/ssh/target.js'

describe('parseSshTarget', () => {
  it("parses git's scp-like syntax, with or without a user", () => {
    expect(parseSshTarget('git@github.com:acme/widgets.git')).toEqual({ host: 'github.com', user: 'git' })
    expect(parseSshTarget('github-work:acme/widgets.git')).toEqual({ host: 'github-work' })
  })

  it('parses ssh:// URLs, including a port, a bracketed IPv6 host, and the git+ssh spellings', () => {
    expect(parseSshTarget('ssh://git@example.com:2222/acme/widgets.git')).toEqual({ host: 'example.com', user: 'git', port: 2222 })
    expect(parseSshTarget('ssh://[::1]/repo.git')).toEqual({ host: '::1' })
    expect(parseSshTarget('git+ssh://git@example.com/repo.git')).toEqual({ host: 'example.com', user: 'git' })
    expect(parseSshTarget('ssh+git://example.com/repo.git')).toEqual({ host: 'example.com' })
  })

  it('returns null for HTTPS, file URLs, and local paths', () => {
    expect(parseSshTarget('https://github.com/acme/widgets.git')).toBeNull()
    expect(parseSshTarget('file:///srv/repos/widgets.git')).toBeNull()
    expect(parseSshTarget('/srv/repos/widgets')).toBeNull()
    expect(parseSshTarget('./relative/with:colon')).toBeNull()
    expect(parseSshTarget('C:\\repos\\widgets')).toBeNull()
  })
})

describe('sshTargetKey', () => {
  it('distinguishes the same host reached as different users or ports', () => {
    const keys = [
      sshTargetKey({ host: 'github.com', user: 'git' }),
      sshTargetKey({ host: 'github.com' }),
      sshTargetKey({ host: 'github.com', user: 'git', port: 443 }),
    ]

    expect(new Set(keys).size).toBe(3)
    expect(sshTargetKey({ host: 'github.com', user: 'git' })).toBe(keys[0])
  })
})
