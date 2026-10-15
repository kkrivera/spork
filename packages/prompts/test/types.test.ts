import { describe, expect, it } from 'vitest'
import { NotInteractiveError } from '../src/types.js'

describe('NotInteractiveError', () => {
  it('has a default message and the right name', () => {
    const error = new NotInteractiveError()

    expect(error.name).toBe('NotInteractiveError')
    expect(error.message).toBe('Cannot prompt interactively: not a TTY.')
    expect(error).toBeInstanceOf(Error)
  })

  it('accepts a custom message', () => {
    expect(new NotInteractiveError('nope').message).toBe('nope')
  })
})
