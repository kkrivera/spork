import { fuzzyMatch } from './fuzzy.js'
import type { Key, PromptOption } from './types.js'

export interface FilteredOption<T> {
  option: PromptOption<T>
  /** Index into the original (unfiltered) `options` array — `selected` tracks these, not positions in `filtered`, so a selection survives a changing search. */
  index: number
  /** Matched character indices into `option.label`, for highlighting. Empty when the query is empty. */
  matches: number[]
}

export interface SelectState<T> {
  options: PromptOption<T>[]
  mode: 'single' | 'multi'
  minSelected: number
  query: string
  cursor: number
  selected: Set<number>
  filtered: FilteredOption<T>[]
  /** Set when Enter was rejected (multi-select below `minSelected`); cleared on the next key. */
  validationMessage: string | null
  /** Set once the prompt has settled; `applyKey` is a no-op after that. */
  done: 'confirmed' | 'cancelled' | null
}

/** Re-filters `options` against `query`, keyed by original index. Sorted by score when `query` is non-empty; left in original order when it's empty (so clearing the search doesn't reshuffle the list). */
export function filterOptions<T>(options: PromptOption<T>[], query: string): FilteredOption<T>[] {
  const matched = options
    .map((option, index) => {
      const match = fuzzyMatch(query, option.label)
      return match && { option, index, matches: match.matches, score: match.score }
    })
    .filter((entry): entry is FilteredOption<T> & { score: number } => entry !== null)

  if (query.length === 0) return matched

  return [...matched].sort((a, b) => b.score - a.score || a.index - b.index)
}

function clampCursor(cursor: number, filteredLength: number): number {
  if (filteredLength === 0) return 0
  return Math.min(Math.max(cursor, 0), filteredLength - 1)
}

export function createInitialState<T>(options: PromptOption<T>[], mode: 'single' | 'multi', minSelected = 0): SelectState<T> {
  const selected = new Set<number>()
  options.forEach((option, index) => {
    if (option.selected) selected.add(index)
  })

  return {
    options,
    mode,
    minSelected,
    query: '',
    cursor: 0,
    selected,
    filtered: filterOptions(options, ''),
    validationMessage: null,
    done: null,
  }
}

function withQuery<T>(state: SelectState<T>, query: string): SelectState<T> {
  return { ...state, query, filtered: filterOptions(state.options, query), cursor: 0, validationMessage: null }
}

function toggleSelected<T>(state: SelectState<T>, index: number): Set<number> {
  const selected = new Set(state.selected)
  if (selected.has(index)) selected.delete(index)
  else selected.add(index)
  return selected
}

function toggleSelectAll<T>(state: SelectState<T>): Set<number> {
  const allFilteredSelected = state.filtered.every((f) => state.selected.has(f.index))
  const selected = new Set(state.selected)
  for (const f of state.filtered) {
    if (allFilteredSelected) selected.delete(f.index)
    else selected.add(f.index)
  }
  return selected
}

function applyEnter<T>(state: SelectState<T>): SelectState<T> {
  const current = state.filtered[state.cursor]
  if (!current) return state

  if (state.mode === 'single') {
    return { ...state, selected: new Set([current.index]), done: 'confirmed' }
  }

  if (state.selected.size < state.minSelected) {
    return { ...state, validationMessage: `Select at least ${state.minSelected}.` }
  }
  return { ...state, done: 'confirmed' }
}

/** The whole prompt's state transition, as one pure reducer — a no-op once `state.done` is set. */
export function applyKey<T>(state: SelectState<T>, key: Key): SelectState<T> {
  if (state.done !== null) return state

  switch (key.type) {
    case 'up':
      return { ...state, cursor: clampCursor(state.cursor - 1, state.filtered.length) }
    case 'down':
      return { ...state, cursor: clampCursor(state.cursor + 1, state.filtered.length) }
    case 'space': {
      if (state.mode !== 'multi') return state
      const current = state.filtered[state.cursor]
      if (!current) return state
      return { ...state, selected: toggleSelected(state, current.index), validationMessage: null }
    }
    case 'selectAll':
      if (state.mode !== 'multi') return state
      return { ...state, selected: toggleSelectAll(state), validationMessage: null }
    case 'clearQuery':
      return withQuery(state, '')
    case 'backspace':
      return state.query.length === 0 ? state : withQuery(state, state.query.slice(0, -1))
    case 'char':
      return withQuery(state, state.query + key.char)
    case 'enter':
      return applyEnter(state)
    case 'escape':
      return { ...state, done: 'cancelled' }
  }
}

/** The confirmed selection, in original option order — call only once `state.done === 'confirmed'`. */
export function resolveSelection<T>(state: SelectState<T>): T[] {
  return state.options.filter((_, index) => state.selected.has(index)).map((option) => option.value)
}
