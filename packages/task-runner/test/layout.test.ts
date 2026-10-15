import { describe, expect, it } from 'vitest'
import { clampWidth, equalPaneLines, formatDuration } from '../src/layout.js'

describe('formatDuration', () => {
  it('shows milliseconds under a second', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(919)).toBe('919ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('shows seconds with 3 decimals at or above a second', () => {
    expect(formatDuration(1000)).toBe('1.000s')
    expect(formatDuration(3727)).toBe('3.727s')
  })
})

describe('equalPaneLines', () => {
  it('splits the full terminal height evenly across every task', () => {
    expect(equalPaneLines(30, 3)).toBe(10)
  })

  it('does not change as tasks finish — a settled task keeps its own share', () => {
    expect(equalPaneLines(30, 3)).toBe(equalPaneLines(30, 3))
  })

  it('is 0 when there are no tasks', () => {
    expect(equalPaneLines(30, 0)).toBe(0)
  })

  it('floors to 0 rather than going negative when there are more tasks than rows', () => {
    expect(equalPaneLines(5, 10)).toBe(0)
  })

  it('shrinks as the terminal shrinks and grows as it grows (resize)', () => {
    const small = equalPaneLines(10, 2)
    const large = equalPaneLines(50, 2)
    expect(large).toBeGreaterThan(small)
  })
})

describe('clampWidth', () => {
  it('leaves a line shorter than the width unchanged', () => {
    expect(clampWidth('short', 80)).toBe('short')
  })

  it('truncates an overlong line with an ellipsis', () => {
    const result = clampWidth('a'.repeat(100), 10)
    expect(result).toHaveLength(10)
    expect(result.endsWith('…')).toBe(true)
  })

  it('handles a width of 1 without throwing', () => {
    expect(clampWidth('abcdef', 1)).toBe('a')
  })

  it('leaves the line unchanged when columns is 0 or negative (unknown width)', () => {
    expect(clampWidth('abcdef', 0)).toBe('abcdef')
  })
})
