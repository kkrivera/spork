import { describe, expect, it, vi, beforeEach } from 'vitest'

const mkdirMock = vi.fn()
const lockMock = vi.fn()

vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mkdirMock(...args),
}))
vi.mock('proper-lockfile', () => ({
  default: { lock: (...args: unknown[]) => lockMock(...args) },
}))

const { withRepoLock } = await import('../../src/repo/lock.js')

beforeEach(() => {
  mkdirMock.mockReset().mockResolvedValue(undefined)
  lockMock.mockReset()
})

describe('withRepoLock', () => {
  it('ensures the target exists, locks it, runs fn, then releases', async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    lockMock.mockResolvedValue(release)
    const fn = vi.fn().mockResolvedValue('result')

    const result = await withRepoLock('/repos/widgets-abc123', fn)

    expect(result).toBe('result')
    expect(mkdirMock).toHaveBeenCalledWith('/repos/widgets-abc123', { recursive: true })
    expect(lockMock).toHaveBeenCalledWith('/repos/widgets-abc123', expect.any(Object))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)

    const fnOrder = fn.mock.invocationCallOrder[0]
    const releaseOrder = release.mock.invocationCallOrder[0]
    expect(fnOrder).toBeLessThan(releaseOrder)
  })

  it('still releases the lock when fn throws', async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    lockMock.mockResolvedValue(release)
    const fn = vi.fn().mockRejectedValue(new Error('boom'))

    await expect(withRepoLock('/repos/widgets-abc123', fn)).rejects.toThrow('boom')
    expect(release).toHaveBeenCalledTimes(1)
  })
})
