import { describe, expect, it } from 'vitest'
import { formatTable } from '../../src/output/format.js'

describe('formatTable', () => {
  it('aligns columns to the widest cell, including the header', () => {
    const table = formatTable(
      ['NAME', 'BRANCH'],
      [
        ['widgets', 'main'],
        ['gadgets-service', 'release/2.0'],
      ],
    )

    expect(table).toBe(['NAME             BRANCH', 'widgets          main', 'gadgets-service  release/2.0'].join('\n'))
  })

  it('renders just the header row for an empty table', () => {
    expect(formatTable(['NAME'], [])).toBe('NAME')
  })

  it('trims trailing padding off the last column', () => {
    const table = formatTable(['A', 'B'], [['x', 'y']])

    expect(table.split('\n').every((line) => line === line.trimEnd())).toBe(true)
  })

  it('treats a row with fewer cells than headers as blank in the missing columns', () => {
    const table = formatTable(['A', 'B'], [['x']])

    expect(table).toBe(['A  B', 'x'].join('\n'))
  })
})
