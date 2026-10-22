import { describe, expect, it } from 'vitest'
import { authFailureGuidance, isAuthFailure } from '../../src/git/auth.js'

describe('isAuthFailure', () => {
  it.each([
    'git@github.com: Permission denied (publickey).',
    'Host key verification failed.',
    "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    "fatal: could not read Password for 'https://me@github.com': No such device or address",
    "fatal: Authentication failed for 'https://github.com/acme/widgets.git/'",
    'remote: Invalid username or token.',
  ])('recognizes %j', (stderr) => {
    expect(isAuthFailure(stderr)).toBe(true)
  })

  it('does not flag an unrelated failure', () => {
    expect(isAuthFailure("fatal: repository 'https://github.com/acme/nope.git/' not found")).toBe(false)
  })
})

describe('authFailureGuidance', () => {
  it('explains why nothing prompted, and points at the interactive single add, when prompts were off', () => {
    const guidance = authFailureGuidance(false)

    expect(guidance).toContain("doesn't let git stop and wait")
    expect(guidance).toContain('ssh-add --apple-use-keychain')
    expect(guidance).toContain('ssh -T git@<host>')
    expect(guidance).toContain('gh auth setup-git')
    expect(guidance).toContain('spork repo add <source>')
  })

  it('skips both of those when prompts were on', () => {
    const guidance = authFailureGuidance(true)

    expect(guidance).not.toContain("doesn't let git stop and wait")
    expect(guidance).not.toContain('spork repo add <source>')
    expect(guidance).toContain('ssh-add')
  })
})
