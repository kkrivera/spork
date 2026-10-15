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

/** Drives every task's run() the way the real runFunctionTask would, capturing each one's output for the fake TaskResult. */
function driveTasks(outputs: string[][] = []): void {
  runTasksMock.mockImplementation(async (tasks) => {
    const fnTasks = tasks as FunctionTask[]
    return Promise.all(
      fnTasks.map(async (task, i) => {
        try {
          await task.run({ log: vi.fn() }, new AbortController().signal)
        } catch {
          // swallowed by runFunctionTask in the real implementation; mirrored here
        }
        return fakeResult({ name: task.name, output: outputs[i] ?? [] })
      }),
    )
  })
}

beforeEach(() => {
  runTasksMock.mockReset()
})

describe('runConcurrently', () => {
  it('builds one FunctionTask per item and runs them all through runTasks', async () => {
    driveTasks()

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
  it('captures the raw thrown error and its message for a call that rejects', async () => {
    driveTasks([['boom']])
    const thrown = new Error('boom')

    const outcomes = await runConcurrently([{ name: 'broken', call: () => Promise.reject(thrown) }])

    expect(outcomes[0]?.value).toBeUndefined()
    expect(outcomes[0]?.error).toBe(thrown)
    expect(outcomes[0]?.errorMessage).toBe('boom')
  })

  it('falls back to the task\'s captured output for errorMessage when the thrown value is not an Error', async () => {
    driveTasks([['not an Error instance']])

    const outcomes = await runConcurrently([{ name: 'broken', call: () => Promise.reject('not an Error instance') }])

    expect(outcomes[0]?.errorMessage).toBe('not an Error instance')
  })

  it('does not treat a call that legitimately resolves to undefined as a failure', async () => {
    driveTasks()

    const outcomes = await runConcurrently([{ name: 'void-task', call: async () => undefined }])

    expect(outcomes[0]?.value).toBeUndefined()
    expect(outcomes[0]?.error).toBeUndefined()
    expect(outcomes[0]?.errorMessage).toBeUndefined()
  })

  it('reports cancelled without an error when the task was cancelled', async () => {
    runTasksMock.mockResolvedValue([fakeResult({ name: 'long', cancelled: true })])

    const outcomes = await runConcurrently([{ name: 'long', call: () => new Promise(() => {}) }])

    expect(outcomes[0]?.cancelled).toBe(true)
    expect(outcomes[0]?.error).toBeUndefined()
    expect(outcomes[0]?.errorMessage).toBeUndefined()
  })
})
