import { describe, expect, it } from 'vitest'
import { fuzzyMatch } from '../src/fuzzy.js'

describe('fuzzyMatch — basic matching', () => {
  it('matches an empty query against anything, with score 0 and no highlights', () => {
    expect(fuzzyMatch('', 'widgets')).toEqual({ score: 0, matches: [] })
  })

  it('matches a subsequence that is not contiguous', () => {
    const result = fuzzyMatch('wdg', 'widgets')

    expect(result).not.toBeNull()
    expect(result?.matches).toEqual([0, 2, 3])
  })

  it('is case-insensitive', () => {
    expect(fuzzyMatch('WID', 'widgets')).not.toBeNull()
    expect(fuzzyMatch('wid', 'WIDGETS')).not.toBeNull()
  })

  it('returns null when a query character is missing entirely', () => {
    expect(fuzzyMatch('wdz', 'widgets')).toBeNull()
  })

  it('returns null when the query is longer than what text can supply', () => {
    expect(fuzzyMatch('widgetsss', 'widgets')).toBeNull()
  })

  it('matches the text against itself exactly', () => {
    const result = fuzzyMatch('widgets', 'widgets')
    expect(result?.matches).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})

describe('fuzzyMatch — scoring', () => {
  it('scores a contiguous run higher than the same letters scattered across non-boundary positions', () => {
    const contiguous = fuzzyMatch('cat', 'catalog')
    const scattered = fuzzyMatch('cat', 'crazy-ant-trap')

    expect(contiguous?.score).toBeGreaterThan(scattered?.score ?? 0)
  })

  it('scores a match starting at the very beginning higher than one starting mid-word', () => {
    const atStart = fuzzyMatch('wid', 'widgets')
    const midWord = fuzzyMatch('wid', 'awidgets')

    expect(atStart?.score).toBeGreaterThan(midWord?.score ?? 0)
  })

  it('scores a match right after a separator higher than one with no separator before it', () => {
    const afterSeparator = fuzzyMatch('cat', 'repo-catalog')
    const noSeparator = fuzzyMatch('cat', 'repocatalog')

    expect(afterSeparator?.score).toBeGreaterThan(noSeparator?.score ?? 0)
  })

  it('greedily matches the earliest available occurrence for a repeated query character', () => {
    const result = fuzzyMatch('aa', 'banana')

    expect(result?.matches).toEqual([1, 3])
  })
})
