import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

const { spawn } = await import('node:child_process')
const { createShellExecutor } = await import('../src/commandExecutor.js')

const spawnMock = vi.mocked(spawn)

class FakeChild extends EventEmitter {}

let fakeChild: FakeChild

beforeEach(() => {
  fakeChild = new FakeChild()
  spawnMock.mockReset().mockReturnValue(fakeChild as never)
})

describe('createShellExecutor', () => {
  it('spawns the command through a real shell with inherited stdio, at the given cwd', () => {
    createShellExecutor().run('npm run dev', '/ws/demo')

    expect(spawnMock).toHaveBeenCalledWith('npm run dev', { cwd: '/ws/demo', shell: true, stdio: 'inherit' })
  })

  it('resolves with the exit code once the child settles', async () => {
    const promise = createShellExecutor().run('npm run dev', '/ws/demo')
    fakeChild.emit('exit', 0, null)

    await expect(promise).resolves.toEqual({ exitCode: 0, signal: null })
  })

  it('resolves with a non-zero exit code rather than throwing', async () => {
    const promise = createShellExecutor().run('npm test', '/ws/demo')
    fakeChild.emit('exit', 1, null)

    await expect(promise).resolves.toEqual({ exitCode: 1, signal: null })
  })

  it('resolves with the signal when the child was killed instead of exiting', async () => {
    const promise = createShellExecutor().run('npm run dev', '/ws/demo')
    fakeChild.emit('exit', null, 'SIGINT')

    await expect(promise).resolves.toEqual({ exitCode: null, signal: 'SIGINT' })
  })

  it('rejects if the command could not be spawned at all', async () => {
    const promise = createShellExecutor().run('does-not-exist', '/ws/demo')
    fakeChild.emit('error', new Error('spawn ENOENT'))

    await expect(promise).rejects.toThrow('spawn ENOENT')
  })
})
