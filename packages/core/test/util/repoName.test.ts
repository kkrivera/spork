import { describe, expect, it } from 'vitest'
import { repoShortName } from '../../src/util/repoName.js'

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
