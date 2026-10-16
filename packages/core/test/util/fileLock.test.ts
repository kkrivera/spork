import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { withFileLock } from '../../src/util/fileLock.js'

let root: string
let filePath: string

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'spork-filelock-'))
  filePath = path.join(root, 'index.json')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('withFileLock', () => {
  it('works on a path that does not exist yet', async () => {
    const result = await withFileLock(filePath, async () => 'ok')
    expect(result).toBe('ok')
  })

  it('serializes a classic read-modify-write race: concurrent callers do not lose updates', async () => {
    let counter = 0
    const increment = (): Promise<void> =>
      withFileLock(filePath, async () => {
        const current = counter
        await sleep(5) // widen the race window — without the lock, this reliably loses updates
        counter = current + 1
      })

    await Promise.all(Array.from({ length: 10 }, increment))

    expect(counter).toBe(10)
  })

  it('releases the lock even when fn throws, so a failed caller does not block the rest', async () => {
    await expect(
      withFileLock(filePath, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    await expect(withFileLock(filePath, async () => 'still works')).resolves.toBe('still works')
  })
})
