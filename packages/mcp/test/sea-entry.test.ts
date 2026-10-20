import { afterEach, describe, expect, it, vi } from 'vitest'

const main = vi.fn()

vi.mock('../src/index.js', () => ({ main }))

describe('sea-entry', () => {
  afterEach(() => {
    process.exitCode = 0
  })

  it('invokes main() unconditionally', async () => {
    main.mockResolvedValueOnce(undefined)

    await import('../src/sea-entry.js')

    expect(main).toHaveBeenCalledTimes(1)
  })

  it('logs and sets a failing exit code on rejection', async () => {
    vi.resetModules()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    main.mockReset().mockRejectedValueOnce(new Error('boom'))

    await import('../src/sea-entry.js')
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith('boom'))

    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })
})
