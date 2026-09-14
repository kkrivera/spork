import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProgram, handleFatalError, main } from '../src/index.js'

describe('createProgram', () => {
  it('sets the program name, description, and version', () => {
    const program = createProgram()

    expect(program.name()).toBe('spork')
    expect(program.description()).toContain('workspaces')
    expect(program.version()).toBe('0.1.0')
  })

  it('registers --color/--no-color as recognized options', () => {
    const program = createProgram()

    const flags = program.options.map((option) => option.flags)
    expect(flags).toContain('--color')
    expect(flags).toContain('--no-color')
  })
})

describe('main', () => {
  it('parses an empty command line without throwing', async () => {
    await expect(main(['node', 'spork'])).resolves.toBeUndefined()
  })
})

describe('handleFatalError', () => {
  afterEach(() => {
    process.exitCode = 0
  })

  it('prints an Error message in red and sets a failing exit code', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    handleFatalError(new Error('boom'))

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0]?.[0]).toContain('boom')
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })

  it('stringifies a non-Error thrown value', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    handleFatalError('not an Error instance')

    expect(errorSpy.mock.calls[0]?.[0]).toContain('not an Error instance')
    errorSpy.mockRestore()
  })
})
