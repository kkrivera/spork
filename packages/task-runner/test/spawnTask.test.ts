import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskState } from '../src/types.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

const { spawn } = await import('node:child_process')
const { spawnTask } = await import('../src/spawnTask.js')

const spawnMock = vi.mocked(spawn)

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = vi.fn()
}

function newState(): TaskState {
  return {
    task: { name: 'widgets', command: 'echo', args: ['hi'] },
    status: 'pending',
    output: [],
    startedAt: null,
    endedAt: null,
    exitCode: null,
    signal: null,
  }
}

let fakeChild: FakeChild

beforeEach(() => {
  fakeChild = new FakeChild()
  spawnMock.mockReset().mockReturnValue(fakeChild as never)
})

describe('spawnTask', () => {
  it('transitions pending -> running immediately, passing command/args/cwd/env/signal through', async () => {
    const state = newState()
    state.task.cwd = '/work'
    state.task.env = { FOO: 'bar' }
    const controller = new AbortController()
    const onChange = vi.fn()

    const promise = spawnTask(state, controller.signal, onChange)

    expect(spawnMock).toHaveBeenCalledWith('echo', ['hi'], { cwd: '/work', env: { FOO: 'bar' }, signal: controller.signal })
    expect(state.status).toBe('running')
    expect(state.startedAt).not.toBeNull()

    fakeChild.emit('close', 0, null)
    await promise
  })

  it('captures stdout and stderr lines in arrival order, buffering partial lines across chunks', async () => {
    const state = newState()
    const promise = spawnTask(state, new AbortController().signal, vi.fn())

    fakeChild.stdout.emit('data', Buffer.from('hello '))
    fakeChild.stdout.emit('data', Buffer.from('world\n'))
    fakeChild.stderr.emit('data', Buffer.from('uh oh\n'))
    fakeChild.emit('close', 0, null)

    await promise

    expect(state.output).toEqual(['hello world', 'uh oh'])
  })

  it('flushes a trailing partial line (no final newline) once the process settles', async () => {
    const state = newState()
    const promise = spawnTask(state, new AbortController().signal, vi.fn())

    fakeChild.stdout.emit('data', Buffer.from('no newline at the end'))
    fakeChild.emit('close', 0, null)

    await promise

    expect(state.output).toEqual(['no newline at the end'])
  })
})

describe('spawnTask — exit status', () => {
  it('marks a zero exit as success and a non-zero exit as failed', async () => {
    const success = newState()
    const successPromise = spawnTask(success, new AbortController().signal, vi.fn())
    fakeChild.emit('close', 0, null)
    await successPromise
    expect(success.status).toBe('success')
    expect(success.exitCode).toBe(0)

    fakeChild = new FakeChild()
    spawnMock.mockReturnValue(fakeChild as never)
    const failed = newState()
    const failedPromise = spawnTask(failed, new AbortController().signal, vi.fn())
    fakeChild.emit('close', 1, null)
    await failedPromise
    expect(failed.status).toBe('failed')
    expect(failed.exitCode).toBe(1)
  })

  it('marks a task cancelled instead of failed when it settles after the signal aborted', async () => {
    const state = newState()
    const controller = new AbortController()
    const promise = spawnTask(state, controller.signal, vi.fn())

    controller.abort()
    fakeChild.emit('close', null, 'SIGTERM')

    await promise

    expect(state.status).toBe('cancelled')
  })

  it('captures a spawn error (e.g. ENOENT) as output and settles without hanging', async () => {
    const state = newState()
    const promise = spawnTask(state, new AbortController().signal, vi.fn())

    fakeChild.emit('error', new Error('spawn echo ENOENT'))
    fakeChild.emit('close', null, null)

    const result = await promise

    expect(result.status).toBe('failed')
    expect(result.output).toContain('spawn echo ENOENT')
  })

  it('calls onChange on every transition', async () => {
    const state = newState()
    const onChange = vi.fn()
    const promise = spawnTask(state, new AbortController().signal, onChange)

    fakeChild.stdout.emit('data', Buffer.from('line\n'))
    fakeChild.emit('close', 0, null)
    await promise

    // running, output, settle — at least 3 notifications
    expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(3)
  })
})

describe('spawnTask — cancellation escalation', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not escalate when the process exits promptly after an abort', async () => {
    vi.useFakeTimers()
    const state = newState()
    const controller = new AbortController()
    const promise = spawnTask(state, controller.signal, vi.fn())

    controller.abort()
    fakeChild.emit('close', null, 'SIGTERM')
    await promise

    vi.advanceTimersByTime(10_000)
    expect(fakeChild.kill).not.toHaveBeenCalled()
  })

  it('escalates to SIGKILL if the process ignores the initial signal (e.g. traps SIGTERM)', async () => {
    vi.useFakeTimers()
    const state = newState()
    const controller = new AbortController()
    void spawnTask(state, controller.signal, vi.fn())

    controller.abort()
    // process doesn't exit — simulating a SIGTERM trap that doesn't actually terminate
    vi.advanceTimersByTime(2000)

    expect(fakeChild.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('force-settles as cancelled rather than hanging if even SIGKILL goes unconfirmed', async () => {
    vi.useFakeTimers()
    const state = newState()
    const controller = new AbortController()
    const promise = spawnTask(state, controller.signal, vi.fn())

    controller.abort()
    vi.advanceTimersByTime(4000)
    const result = await promise

    expect(result.status).toBe('cancelled')
  })
})
