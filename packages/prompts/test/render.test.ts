import pc from 'picocolors'
import { describe, expect, it } from 'vitest'
import { renderFrame } from '../src/render.js'
import type { FilteredOption, SelectState } from '../src/state.js'

const colors = pc.createColors(false)

function filteredOption(label: string, index: number, overrides: Partial<{ matches: number[]; hint: string }> = {}): FilteredOption<string> {
  return { option: { label, value: label, hint: overrides.hint }, index, matches: overrides.matches ?? [] }
}

function state(overrides: Partial<SelectState<string>> = {}): SelectState<string> {
  const filtered = overrides.filtered ?? [filteredOption('widgets', 0), filteredOption('gadgets', 1)]
  return {
    options: filtered.map((f) => f.option),
    mode: 'multi',
    minSelected: 0,
    query: '',
    cursor: 0,
    selected: new Set(),
    filtered,
    validationMessage: null,
    done: null,
    ...overrides,
  }
}

describe('renderFrame — header', () => {
  it('shows the message and the current search query', () => {
    const lines = renderFrame(state({ query: 'wid' }), 'Pick repos', 80, 24, colors)
    expect(lines[0]).toContain('Pick repos')
    expect(lines[0]).toContain('wid')
  })
})

describe('renderFrame — option rows', () => {
  it('marks a selected option with a checkbox in multi-select mode', () => {
    const lines = renderFrame(state({ selected: new Set([0]) }), 'msg', 80, 24, colors)
    expect(lines.some((l) => l.includes('[x]') && l.includes('widgets'))).toBe(true)
    expect(lines.some((l) => l.includes('[ ]') && l.includes('gadgets'))).toBe(true)
  })

  it('shows no checkbox in single-select mode', () => {
    const lines = renderFrame(state({ mode: 'single' }), 'msg', 80, 24, colors)
    expect(lines.join('\n')).not.toContain('[')
  })

  it('marks the cursor row with a pointer', () => {
    const lines = renderFrame(state({ cursor: 1 }), 'msg', 80, 24, colors)
    const gadgetsLine = lines.find((l) => l.includes('gadgets'))
    expect(gadgetsLine).toContain('❯')
  })

  it('shows a dimmed hint after the label when the option has one', () => {
    const lines = renderFrame(
      state({ filtered: [filteredOption('widgets', 0, { hint: 'acme/widgets.git' })] }),
      'msg',
      80,
      24,
      colors,
    )
    expect(lines.some((l) => l.includes('acme/widgets.git'))).toBe(true)
  })

  it('bolds the fuzzy-matched characters when color is enabled', () => {
    const enabled = pc.createColors(true)
    const lines = renderFrame(
      state({ query: 'w', filtered: [filteredOption('widgets', 0, { matches: [0] })] }),
      'msg',
      80,
      24,
      enabled,
    )
    const optionLine = lines.find((l) => l.includes('idgets')) // the unmatched remainder of "widgets"
    expect(optionLine).toContain('\x1b[1m') // bold ANSI escape wraps the matched "w"
  })

  it('shows "No matches." when the filtered list is empty', () => {
    const lines = renderFrame(state({ filtered: [] }), 'msg', 80, 24, colors)
    expect(lines.some((l) => l.includes('No matches.'))).toBe(true)
  })
})

describe('renderFrame — footer', () => {
  it('shows a selected count and multi-select key hints', () => {
    const lines = renderFrame(state({ selected: new Set([0, 1]) }), 'msg', 80, 24, colors)
    expect(lines.at(-1)).toContain('2 selected')
    expect(lines.at(-1)).toContain('space toggle')
  })

  it('omits the count in single-select mode', () => {
    const lines = renderFrame(state({ mode: 'single' }), 'msg', 80, 24, colors)
    expect(lines.at(-1)).not.toContain('selected')
  })

  it('shows the validation message instead of the hints when set', () => {
    const lines = renderFrame(state({ validationMessage: 'Select at least 1.' }), 'msg', 80, 24, colors)
    expect(lines.at(-1)).toBe('Select at least 1.')
  })
})

describe('renderFrame — viewport and width', () => {
  it('windows a long list to the available rows, keeping the cursor visible', () => {
    const filtered = Array.from({ length: 20 }, (_, i) => filteredOption(`option-${i}`, i))
    const lines = renderFrame(state({ filtered, cursor: 19 }), 'msg', 80, 10, colors)

    expect(lines.join('\n')).toContain('option-19')
    expect(lines.join('\n')).not.toContain('option-0\n')
  })

  it('truncates an overlong line to the terminal width', () => {
    const filtered = [filteredOption('x'.repeat(200), 0)]
    const lines = renderFrame(state({ filtered }), 'msg', 40, 24, colors)
    expect(lines.every((l) => l.length <= 40)).toBe(true)
  })
})
