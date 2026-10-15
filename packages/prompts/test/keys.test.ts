import { describe, expect, it } from 'vitest'
import { toKey } from '../src/keys.js'
import type { NodeKeypress } from '../src/types.js'

function keypress(overrides: Partial<NodeKeypress> = {}): NodeKeypress {
  return { ctrl: false, meta: false, shift: false, ...overrides }
}

describe('toKey — control keys', () => {
  it('maps Escape to escape', () => {
    expect(toKey(undefined, keypress({ name: 'escape' }))).toEqual({ type: 'escape' })
  })

  it('maps Ctrl+C to escape (cancel), not a literal "c" character', () => {
    expect(toKey('c', keypress({ name: 'c', ctrl: true }))).toEqual({ type: 'escape' })
  })

  it('maps Return to enter', () => {
    expect(toKey(undefined, keypress({ name: 'return' }))).toEqual({ type: 'enter' })
  })

  it('maps the arrow keys', () => {
    expect(toKey(undefined, keypress({ name: 'up' }))).toEqual({ type: 'up' })
    expect(toKey(undefined, keypress({ name: 'down' }))).toEqual({ type: 'down' })
  })

  it('maps Backspace', () => {
    expect(toKey(undefined, keypress({ name: 'backspace' }))).toEqual({ type: 'backspace' })
  })

  it('maps Ctrl+A to selectAll, not a literal "a" character', () => {
    expect(toKey('a', keypress({ name: 'a', ctrl: true }))).toEqual({ type: 'selectAll' })
  })

  it('maps Ctrl+U to clearQuery, not a literal "u" character', () => {
    expect(toKey('u', keypress({ name: 'u', ctrl: true }))).toEqual({ type: 'clearQuery' })
  })
})

describe('toKey — text input', () => {
  it('maps a literal space to space (toggle), never inserting it into the query', () => {
    expect(toKey(' ', keypress({ name: 'space' }))).toEqual({ type: 'space' })
  })

  it('maps a plain printable character to char', () => {
    expect(toKey('w', keypress({ name: 'w' }))).toEqual({ type: 'char', char: 'w' })
  })

  it('ignores a Ctrl/Meta combination it does not recognize, rather than treating it as text', () => {
    expect(toKey('x', keypress({ name: 'x', ctrl: true }))).toBeNull()
    expect(toKey('x', keypress({ name: 'x', meta: true }))).toBeNull()
  })

  it('returns null for an unrecognized key with no printable character', () => {
    expect(toKey(undefined, keypress({ name: 'f1' }))).toBeNull()
  })
})
