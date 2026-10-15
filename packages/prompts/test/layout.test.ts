import { describe, expect, it } from 'vitest'
import { clampWidth, computeViewport } from '../src/layout.js'

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

describe('computeViewport — fits entirely', () => {
  it('shows everything when the list fits within the height', () => {
    expect(computeViewport(0, 3, 10)).toEqual({ start: 0, end: 3 })
  })

  it('is empty when there is nothing to show', () => {
    expect(computeViewport(0, 0, 10)).toEqual({ start: 0, end: 0 })
  })

  it('is empty when the viewport has no height', () => {
    expect(computeViewport(0, 10, 0)).toEqual({ start: 0, end: 0 })
  })
})

describe('computeViewport — scrolling', () => {
  it('centers the cursor when there is room on both sides', () => {
    expect(computeViewport(5, 20, 5)).toEqual({ start: 3, end: 8 })
  })

  it('clamps at the start rather than scrolling past the first item', () => {
    expect(computeViewport(0, 20, 5)).toEqual({ start: 0, end: 5 })
  })

  it('clamps at the end rather than scrolling past the last item', () => {
    expect(computeViewport(19, 20, 5)).toEqual({ start: 15, end: 20 })
  })
})
