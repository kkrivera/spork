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

  it('registers the workspace and repo command trees by default', () => {
    const program = createProgram()

    const names = program.commands.map((cmd) => cmd.name())
    expect(names).toContain('workspace')
    expect(names).toContain('repo')
  })
})

describe('main', () => {
  it('parses and runs a real subcommand without throwing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(main(['node', 'spork', 'workspace', 'list'])).resolves.toBeUndefined()

    logSpy.mockRestore()
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
