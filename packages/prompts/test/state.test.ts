import { describe, expect, it } from 'vitest'
import { applyKey, createInitialState, filterOptions, resolveSelection } from '../src/state.js'
import type { SelectState } from '../src/state.js'
import type { PromptOption } from '../src/types.js'

const OPTIONS: PromptOption<string>[] = [
  { label: 'widgets', value: 'widgets' },
  { label: 'gadgets', value: 'gadgets' },
  { label: 'connector', value: 'connector' },
]

/** Applies one 'char' key per character — "widgets" also contains a "g", so narrowing to "gadgets" alone needs more than one letter. */
function type<T>(state: SelectState<T>, text: string): SelectState<T> {
  return [...text].reduce((s, char) => applyKey(s, { type: 'char', char }), state)
}

describe('filterOptions', () => {
  it('keeps original order when the query is empty', () => {
    const filtered = filterOptions(OPTIONS, '')
    expect(filtered.map((f) => f.option.label)).toEqual(['widgets', 'gadgets', 'connector'])
  })

  it('narrows and sorts by score when the query is non-empty', () => {
    const filtered = filterOptions(OPTIONS, 'gad')
    expect(filtered.map((f) => f.option.label)).toEqual(['gadgets'])
  })

  it('drops an option that does not match at all', () => {
    const filtered = filterOptions(OPTIONS, 'zzz')
    expect(filtered).toEqual([])
  })

  it('tracks each surviving option by its original index', () => {
    const filtered = filterOptions(OPTIONS, 'connector')
    expect(filtered[0]?.index).toBe(2)
  })

  it('breaks a score tie by original index, keeping ties in list order', () => {
    const ties: PromptOption<string>[] = [
      { label: 'xa', value: 'xa' },
      { label: 'ya', value: 'ya' },
    ]
    expect(filterOptions(ties, 'a').map((f) => f.option.label)).toEqual(['xa', 'ya'])
  })
})

describe('createInitialState', () => {
  it('starts with cursor 0, an empty query, and the full list filtered in', () => {
    const state = createInitialState(OPTIONS, 'multi')
    expect(state.query).toBe('')
    expect(state.cursor).toBe(0)
    expect(state.filtered).toHaveLength(3)
    expect(state.selected.size).toBe(0)
    expect(state.done).toBeNull()
  })

  it('pre-selects options whose `selected` flag is set', () => {
    const preselected: PromptOption<string>[] = [
      { label: 'widgets', value: 'widgets', selected: true },
      { label: 'gadgets', value: 'gadgets' },
    ]
    const state = createInitialState(preselected, 'multi')
    expect(state.selected.has(0)).toBe(true)
    expect(state.selected.has(1)).toBe(false)
  })
})

describe('applyKey — navigation', () => {
  it('moves the cursor down and up, clamped to the filtered list bounds', () => {
    let state = createInitialState(OPTIONS, 'multi')
    state = applyKey(state, { type: 'down' })
    expect(state.cursor).toBe(1)
    state = applyKey(state, { type: 'down' })
    state = applyKey(state, { type: 'down' })
    expect(state.cursor).toBe(2) // clamped at the last option, not 3

    state = applyKey(state, { type: 'up' })
    expect(state.cursor).toBe(1)
  })

  it('does not go below 0', () => {
    const state = applyKey(createInitialState(OPTIONS, 'multi'), { type: 'up' })
    expect(state.cursor).toBe(0)
  })

  it('stays at 0 when the filtered list is empty', () => {
    const empty = type(createInitialState(OPTIONS, 'multi'), 'zzz')
    expect(applyKey(empty, { type: 'down' }).cursor).toBe(0)
  })
})

describe('applyKey — search query', () => {
  it('typing narrows the filtered list and resets the cursor to 0', () => {
    let state = createInitialState(OPTIONS, 'multi')
    state = applyKey(state, { type: 'down' })
    state = type(state, 'gad')
    expect(state.query).toBe('gad')
    expect(state.filtered.map((f) => f.option.label)).toEqual(['gadgets'])
    expect(state.cursor).toBe(0)
  })

  it('backspace removes the last character and re-filters', () => {
    let state = type(createInitialState(OPTIONS, 'multi'), 'gadx')
    expect(state.filtered).toHaveLength(0)

    state = applyKey(state, { type: 'backspace' })
    expect(state.query).toBe('gad')
    expect(state.filtered.map((f) => f.option.label)).toEqual(['gadgets'])
  })

  it('backspace on an empty query is a no-op', () => {
    const state = createInitialState(OPTIONS, 'multi')
    expect(applyKey(state, { type: 'backspace' })).toBe(state)
  })

  it('clearQuery restores the full list, in original order, while keeping prior selections', () => {
    let state = createInitialState(OPTIONS, 'multi')
    state = applyKey(state, { type: 'space' }) // select widgets (index 0) before narrowing
    state = applyKey(state, { type: 'char', char: 'g' })
    state = applyKey(state, { type: 'clearQuery' })

    expect(state.query).toBe('')
    expect(state.filtered.map((f) => f.option.label)).toEqual(['widgets', 'gadgets', 'connector'])
    expect(state.selected.has(0)).toBe(true)
  })
})

describe('applyKey — multi-select toggling', () => {
  it('space toggles the option under the cursor on and off', () => {
    let state = createInitialState(OPTIONS, 'multi')
    state = applyKey(state, { type: 'space' })
    expect(state.selected.has(0)).toBe(true)
    state = applyKey(state, { type: 'space' })
    expect(state.selected.has(0)).toBe(false)
  })

  it('space is a no-op in single-select mode', () => {
    const state = createInitialState(OPTIONS, 'single')
    expect(applyKey(state, { type: 'space' }).selected.size).toBe(0)
  })

  it('space is a no-op when the filtered list is empty', () => {
    const empty = type(createInitialState(OPTIONS, 'multi'), 'zzz')
    expect(applyKey(empty, { type: 'space' }).selected.size).toBe(0)
  })

  it('selectAll is a no-op in single-select mode', () => {
    const state = createInitialState(OPTIONS, 'single')
    expect(applyKey(state, { type: 'selectAll' }).selected.size).toBe(0)
  })

  it('selectAll selects every currently filtered option, leaving filtered-out ones untouched', () => {
    let state = type(createInitialState(OPTIONS, 'multi'), 'gad') // narrows to just "gadgets"
    state = applyKey(state, { type: 'selectAll' })

    expect(state.selected.has(1)).toBe(true) // gadgets
    expect(state.selected.has(0)).toBe(false) // widgets was filtered out, untouched
  })

  it('selectAll again deselects everything currently filtered (toggle)', () => {
    let state = createInitialState(OPTIONS, 'multi')
    state = applyKey(state, { type: 'selectAll' })
    expect(state.selected.size).toBe(3)

    state = applyKey(state, { type: 'selectAll' })
    expect(state.selected.size).toBe(0)
  })
})

describe('applyKey — confirm/cancel', () => {
  it('enter in single-select mode selects the option under the cursor and confirms immediately', () => {
    let state = createInitialState(OPTIONS, 'single')
    state = applyKey(state, { type: 'down' })
    state = applyKey(state, { type: 'enter' })

    expect(state.done).toBe('confirmed')
    expect(resolveSelection(state)).toEqual(['gadgets'])
  })

  it('enter in multi-select mode confirms the current selection regardless of cursor position', () => {
    let state = createInitialState(OPTIONS, 'multi')
    state = applyKey(state, { type: 'space' })
    state = applyKey(state, { type: 'down' })
    state = applyKey(state, { type: 'enter' })

    expect(state.done).toBe('confirmed')
    expect(resolveSelection(state)).toEqual(['widgets'])
  })

  it('enter is a no-op when the filtered list is empty', () => {
    const empty = type(createInitialState(OPTIONS, 'multi'), 'zzz')
    expect(applyKey(empty, { type: 'enter' }).done).toBeNull()
  })

  it('enter is rejected with a validation message when minSelected is not met', () => {
    const state = applyKey(createInitialState(OPTIONS, 'multi', 1), { type: 'enter' })

    expect(state.done).toBeNull()
    expect(state.validationMessage).toBe('Select at least 1.')
  })

  it('escape cancels regardless of mode', () => {
    const state = applyKey(createInitialState(OPTIONS, 'multi'), { type: 'escape' })
    expect(state.done).toBe('cancelled')
  })

  it('is a no-op once the prompt has already settled', () => {
    const done = applyKey(createInitialState(OPTIONS, 'multi'), { type: 'escape' })
    expect(applyKey(done, { type: 'down' })).toBe(done)
  })
})
