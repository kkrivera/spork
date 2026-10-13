import { describe, expect, it } from 'vitest'
import { clampWidth, formatDuration, tailLinesPerRunningTask } from '../src/layout.js'

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

describe('tailLinesPerRunningTask', () => {
  it('splits the remaining rows evenly across running tasks', () => {
    expect(tailLinesPerRunningTask(30, 3, 0)).toBe(10)
  })

  it('reserves one row per already-finished task before dividing', () => {
    expect(tailLinesPerRunningTask(30, 2, 10)).toBe(10)
  })

  it('hands a finished task its share back to the remaining running tasks', () => {
    const beforeFinish = tailLinesPerRunningTask(30, 3, 0)
    const afterOneFinishes = tailLinesPerRunningTask(30, 2, 1)
    expect(afterOneFinishes).toBeGreaterThan(beforeFinish)
  })

  it('is 0 when nothing is running', () => {
    expect(tailLinesPerRunningTask(30, 0, 5)).toBe(0)
  })

  it('floors to 0 rather than going negative when there are more running tasks than rows', () => {
    expect(tailLinesPerRunningTask(5, 10, 0)).toBe(0)
  })

  it('floors to 0 rather than going negative when finished tasks already exceed the rows', () => {
    expect(tailLinesPerRunningTask(5, 2, 20)).toBe(0)
  })

  it('shrinks as the terminal shrinks and grows as it grows (resize)', () => {
    const small = tailLinesPerRunningTask(10, 2, 0)
    const large = tailLinesPerRunningTask(50, 2, 0)
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
