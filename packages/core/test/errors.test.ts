import { describe, expect, it } from 'vitest'
import { SporkError } from '../src/errors.js'

describe('SporkError', () => {
  it('is an Error with its own name', () => {
    const error = new SporkError('bad input')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('SporkError')
    expect(error.message).toBe('bad input')
  })
})
