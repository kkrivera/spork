import { describe, expect, it, vi } from 'vitest'

const main = vi.fn()
const handleFatalError = vi.fn()

vi.mock('../src/index.js', () => ({ main, handleFatalError }))

describe('sea-entry', () => {
  it('invokes main() unconditionally', async () => {
    main.mockResolvedValueOnce(undefined)

    await import('../src/sea-entry.js')

    expect(main).toHaveBeenCalledTimes(1)
  })

  it('routes a rejection to handleFatalError', async () => {
    vi.resetModules()
    const error = new Error('boom')
    main.mockReset().mockRejectedValueOnce(error)

    await import('../src/sea-entry.js')
    await vi.waitFor(() => expect(handleFatalError).toHaveBeenCalledWith(error))
  })
})
