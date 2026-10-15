import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FunctionTask, TaskResult } from '@spork/task-runner'

vi.mock('@spork/task-runner', () => ({
  runTasks: vi.fn(),
}))

const { runTasks } = await import('@spork/task-runner')
const { runConcurrently } = await import('../src/concurrentTasks.js')

const runTasksMock = vi.mocked(runTasks)

function fakeResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return { name: 'x', exitCode: null, signal: null, durationMs: 10, output: [], cancelled: false, ...overrides }
}

beforeEach(() => {
  runTasksMock.mockReset()
})

describe('runConcurrently', () => {
  it('builds one FunctionTask per item and runs them all through runTasks', async () => {
    runTasksMock.mockImplementation(async (tasks) => {
      for (const task of tasks as FunctionTask[]) {
        await task.run({ log: vi.fn() }, new AbortController().signal)
      }
      return tasks.map((t) => fakeResult({ name: t.name }))
    })

    const calls = { a: vi.fn().mockResolvedValue('a-value'), b: vi.fn().mockResolvedValue('b-value') }
    const outcomes = await runConcurrently([
      { name: 'a', call: calls.a },
      { name: 'b', call: calls.b },
    ])

    expect(calls.a).toHaveBeenCalled()
    expect(calls.b).toHaveBeenCalled()
    expect(outcomes.map((o) => [o.name, o.value])).toEqual([
      ['a', 'a-value'],
      ['b', 'b-value'],
    ])
  })
})

describe('runConcurrently — outcomes', () => {
  it('reports an error (the task\'s last captured output line) for a call that rejects', async () => {
    runTasksMock.mockImplementation(async (tasks) => {
      const outputs: string[] = []
      for (const task of tasks as FunctionTask[]) {
        try {
          await task.run({ log: (line) => outputs.push(line) }, new AbortController().signal)
        } catch {
          // swallowed by runFunctionTask in the real implementation; mirrored here
        }
      }
      return [fakeResult({ name: 'broken', output: ['boom'] })]
    })

    const outcomes = await runConcurrently([{ name: 'broken', call: () => Promise.reject(new Error('boom')) }])

    expect(outcomes[0]?.value).toBeUndefined()
    expect(outcomes[0]?.error).toBe('boom')
  })

  it('does not treat a call that legitimately resolves to undefined as a failure', async () => {
    runTasksMock.mockImplementation(async (tasks) => {
      for (const task of tasks as FunctionTask[]) {
        await task.run({ log: vi.fn() }, new AbortController().signal)
      }
      return tasks.map((t) => fakeResult({ name: t.name }))
    })

    const outcomes = await runConcurrently([{ name: 'void-task', call: async () => undefined }])

    expect(outcomes[0]?.value).toBeUndefined()
    expect(outcomes[0]?.error).toBeUndefined()
  })

  it('reports cancelled without an error when the task was cancelled', async () => {
    runTasksMock.mockResolvedValue([fakeResult({ name: 'long', cancelled: true })])

    const outcomes = await runConcurrently([{ name: 'long', call: () => new Promise(() => {}) }])

    expect(outcomes[0]?.cancelled).toBe(true)
    expect(outcomes[0]?.error).toBeUndefined()
  })
})
