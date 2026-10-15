import { EventEmitter } from 'node:events'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenderStream, TaskState } from '../src/types.js'

vi.mock('../src/spawnTask.js', () => ({
  spawnTask: vi.fn(),
}))
vi.mock('../src/runFunctionTask.js', () => ({
  runFunctionTask: vi.fn(),
}))

const { spawnTask } = await import('../src/spawnTask.js')
const { runFunctionTask } = await import('../src/runFunctionTask.js')
const { runTasks } = await import('../src/runTasks.js')

const spawnTaskMock = vi.mocked(spawnTask)
const runFunctionTaskMock = vi.mocked(runFunctionTask)

class FakeStream extends EventEmitter implements RenderStream {
  isTTY = false
  columns = 80
  rows = 24
  write(): boolean {
    return true
  }
}

let stream: FakeStream

beforeEach(() => {
  stream = new FakeStream()
  spawnTaskMock.mockReset()
  runFunctionTaskMock.mockReset()
})

afterEach(() => {
  process.removeAllListeners('SIGINT')
})

/** Resolves `state` as a success after a microtask tick, as a real fast task would. */
function fastSuccess(state: TaskState): Promise<TaskState> {
  state.status = 'success'
  state.exitCode = 0
  state.startedAt = Date.now()
  state.endedAt = Date.now()
  return Promise.resolve(state)
}

describe('runTasks', () => {
  it('runs every task concurrently and returns one result per task, in order', async () => {
    spawnTaskMock.mockImplementation((state) => fastSuccess(state))

    const results = await runTasks(
      [
        { name: 'a', command: 'echo' },
        { name: 'b', command: 'echo' },
      ],
      { stream },
    )

    expect(results.map((r) => r.name)).toEqual(['a', 'b'])
    expect(results.every((r) => r.exitCode === 0 && !r.cancelled)).toBe(true)
  })

  it('lets sibling tasks keep running to completion after one fails', async () => {
    spawnTaskMock.mockImplementation(async (state) => {
      if (state.task.name === 'broken') {
        state.status = 'failed'
        state.exitCode = 1
        return state
      }
      return fastSuccess(state)
    })

    const results = await runTasks(
      [
        { name: 'broken', command: 'false' },
        { name: 'ok', command: 'echo' },
      ],
      { stream },
    )

    const broken = results.find((r) => r.name === 'broken')
    const ok = results.find((r) => r.name === 'ok')
    expect(broken?.exitCode).toBe(1)
    expect(ok?.exitCode).toBe(0)
  })
})

describe('runTasks — task dispatch', () => {
  it('routes a ProcessTask (has command) to spawnTask', async () => {
    spawnTaskMock.mockImplementation((state) => fastSuccess(state))

    await runTasks([{ name: 'a', command: 'echo' }], { stream })

    expect(spawnTaskMock).toHaveBeenCalled()
    expect(runFunctionTaskMock).not.toHaveBeenCalled()
  })

  it('routes a FunctionTask (has run) to runFunctionTask', async () => {
    runFunctionTaskMock.mockImplementation((state) => fastSuccess(state))

    const results = await runTasks([{ name: 'b', run: async () => {} }], { stream })

    expect(runFunctionTaskMock).toHaveBeenCalled()
    expect(spawnTaskMock).not.toHaveBeenCalled()
    expect(results[0]?.name).toBe('b')
  })
})

describe('runTasks — cancellation', () => {
  it('cancels still-running tasks when the caller aborts its own signal', async () => {
    spawnTaskMock.mockImplementation(
      (state, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            state.status = 'cancelled'
            resolve(state)
          })
        }),
    )

    const controller = new AbortController()
    const runPromise = runTasks([{ name: 'long', command: 'sleep' }], { stream, signal: controller.signal })
    controller.abort()
    const results = await runPromise

    expect(results[0]?.cancelled).toBe(true)
  })

  it('cancels still-running tasks on SIGINT', async () => {
    spawnTaskMock.mockImplementation(
      (state, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            state.status = 'cancelled'
            resolve(state)
          })
        }),
    )

    const runPromise = runTasks([{ name: 'long', command: 'sleep' }], { stream })
    process.emit('SIGINT')
    const results = await runPromise

    expect(results[0]?.cancelled).toBe(true)
  })

  it('removes its SIGINT listener once the run settles', async () => {
    spawnTaskMock.mockImplementation((state) => fastSuccess(state))
    const before = process.listenerCount('SIGINT')

    await runTasks([{ name: 'a', command: 'echo' }], { stream })

    expect(process.listenerCount('SIGINT')).toBe(before)
  })
})
