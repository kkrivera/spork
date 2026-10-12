import { describe, expect, it } from 'vitest'
import { repoOwner, repoShortName } from '../../src/util/repoName.js'

describe('repoShortName', () => {
  it('extracts the repo name from an SSH remote URL', () => {
    expect(repoShortName('git@github.com:acme/widgets.git')).toBe('widgets')
  })

  it('extracts the repo name from an HTTPS remote URL', () => {
    expect(repoShortName('https://github.com/acme/widgets.git')).toBe('widgets')
  })

  it('extracts the repo name from a local path', () => {
    expect(repoShortName('/Users/me/code/widgets')).toBe('widgets')
  })

  it('falls back to "repo" when nothing usable remains', () => {
    expect(repoShortName('///')).toBe('repo')
  })
})

describe('repoOwner', () => {
  it('extracts the owner from an SSH remote URL', () => {
    expect(repoOwner('git@github.com:acme/widgets.git')).toBe('acme')
  })

  it('extracts the owner from an HTTPS remote URL', () => {
    expect(repoOwner('https://github.com/acme/widgets.git')).toBe('acme')
  })

  it('uses the immediate parent segment for a nested group path', () => {
    expect(repoOwner('https://gitlab.com/group/subgroup/project.git')).toBe('subgroup')
  })

  it('returns null for a local path (no owner to extract)', () => {
    expect(repoOwner('/Users/me/code/widgets')).toBeNull()
  })

  it('returns null for a bare name with no owner segment', () => {
    expect(repoOwner('git@github.com:widgets.git')).toBeNull()
  })
})
