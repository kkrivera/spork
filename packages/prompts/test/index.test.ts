import { describe, expect, it } from 'vitest'
import { NotInteractiveError } from '../src/index.js'

describe('index', () => {
  it('re-exports NotInteractiveError', () => {
    expect(new NotInteractiveError()).toBeInstanceOf(Error)
  })
})
