import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

const { spawn } = await import('node:child_process')
const { createShellExecutor } = await import('../src/commandExecutor.js')

const spawnMock = vi.mocked(spawn)
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

class FakeChild extends EventEmitter {
  kill = vi.fn()
}

let fakeChild: FakeChild
const originalShell = process.env.SHELL

beforeEach(() => {
  fakeChild = new FakeChild()
  spawnMock.mockReset().mockReturnValue(fakeChild as never)
  process.env.SHELL = '/bin/zsh'
})

afterEach(() => {
  // Defensive: a test that forgets to settle the child shouldn't leak a
  // listener into every test that runs after it.
  for (const signal of FORWARDED_SIGNALS) process.removeAllListeners(signal)
  vi.useRealTimers()
  process.env.SHELL = originalShell
})

describe('createShellExecutor', () => {
  it('spawns the command through the user\'s own $SHELL, with inherited stdio, at the given cwd', () => {
    createShellExecutor().run('npm run dev', '/ws/demo')

    expect(spawnMock).toHaveBeenCalledWith('npm run dev', { cwd: '/ws/demo', shell: '/bin/zsh', stdio: 'inherit' })
  })

  it('falls back to Node\'s own default shell when $SHELL is not set', () => {
    delete process.env.SHELL

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

describe('createShellExecutor — signal forwarding', () => {
  it('forwards SIGINT received by spork itself to the child', async () => {
    const promise = createShellExecutor().run('npm run dev', '/ws/demo')

    process.emit('SIGINT', 'SIGINT')
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGINT')

    fakeChild.emit('exit', null, 'SIGINT')
    await promise
  })

  it('forwards SIGTERM the same way', async () => {
    const promise = createShellExecutor().run('npm run dev', '/ws/demo')

    process.emit('SIGTERM', 'SIGTERM')
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM')

    fakeChild.emit('exit', null, 'SIGTERM')
    await promise
  })

  it('does not resolve until the child actually exits, even after forwarding', async () => {
    const promise = createShellExecutor().run('npm run dev', '/ws/demo')
    let settled = false
    void promise.then(() => (settled = true))

    process.emit('SIGINT', 'SIGINT')
    await Promise.resolve()
    expect(settled).toBe(false)

    fakeChild.emit('exit', null, 'SIGINT')
    await promise
    expect(settled).toBe(true)
  })

  it('escalates to SIGKILL if the child ignores the forwarded signal past the grace period', async () => {
    vi.useFakeTimers()
    const promise = createShellExecutor().run('npm run dev', '/ws/demo')

    process.emit('SIGINT', 'SIGINT')
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGINT')

    await vi.advanceTimersByTimeAsync(2000)
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGKILL')

    fakeChild.emit('exit', null, 'SIGKILL')
    await promise
  })

  it('escalates to SIGKILL immediately on a second, impatient signal', async () => {
    const promise = createShellExecutor().run('npm run dev', '/ws/demo')

    process.emit('SIGINT', 'SIGINT')
    process.emit('SIGINT', 'SIGINT')

    expect(fakeChild.kill).toHaveBeenNthCalledWith(1, 'SIGINT')
    expect(fakeChild.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')

    fakeChild.emit('exit', null, 'SIGKILL')
    await promise
  })
})

describe('createShellExecutor — signal listener cleanup', () => {
  it('stops listening for signals once the child has exited (no leak across runs)', async () => {
    const promise = createShellExecutor().run('npm run dev', '/ws/demo')
    fakeChild.emit('exit', 0, null)
    await promise

    process.emit('SIGINT', 'SIGINT')

    expect(fakeChild.kill).not.toHaveBeenCalled()
  })

  it('stops listening for signals if the child failed to spawn at all', async () => {
    const promise = createShellExecutor().run('does-not-exist', '/ws/demo')
    fakeChild.emit('error', new Error('spawn ENOENT'))
    await promise.catch(() => undefined)

    process.emit('SIGINT', 'SIGINT')

    expect(fakeChild.kill).not.toHaveBeenCalled()
  })
})
