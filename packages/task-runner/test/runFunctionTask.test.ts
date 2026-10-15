import { describe, expect, it, vi } from 'vitest'
import { runFunctionTask } from '../src/runFunctionTask.js'
import type { FunctionTask, TaskState } from '../src/types.js'

function newState(run: FunctionTask['run']): TaskState {
  return {
    task: { name: 'widgets', run },
    status: 'pending',
    output: [],
    startedAt: null,
    endedAt: null,
    exitCode: null,
    signal: null,
  }
}

describe('runFunctionTask', () => {
  it('transitions pending -> running -> success for a resolving task', async () => {
    const onChange = vi.fn()
    const state = newState(async () => {})

    const result = await runFunctionTask(state, new AbortController().signal, onChange)

    expect(result.status).toBe('success')
    expect(result.startedAt).not.toBeNull()
    expect(result.endedAt).not.toBeNull()
    expect(onChange).toHaveBeenCalled()
  })

  it('lets the task body log progress lines via the reporter', async () => {
    const state = newState(async (report) => {
      report.log('cloning')
      report.log('registered')
    })

    const result = await runFunctionTask(state, new AbortController().signal, vi.fn())

    expect(result.output).toEqual(['cloning', 'registered'])
  })

  it('marks a thrown error as failed and captures its message as output', async () => {
    const state = newState(async () => {
      throw new Error('clone failed: no such host')
    })

    const result = await runFunctionTask(state, new AbortController().signal, vi.fn())

    expect(result.status).toBe('failed')
    expect(result.output).toEqual(['clone failed: no such host'])
  })

  it('stringifies a non-Error throw', async () => {
    const state = newState(async () => {
      throw 'not an Error instance'
    })

    const result = await runFunctionTask(state, new AbortController().signal, vi.fn())

    expect(result.output).toEqual(['not an Error instance'])
  })
})

describe('runFunctionTask — cancellation', () => {
  it('marks cancelled instead of failed when the signal was aborted before a thrown error', async () => {
    const controller = new AbortController()
    const state = newState(async (_report, signal) => {
      controller.abort()
      if (signal.aborted) throw new Error('stopped early')
    })

    const result = await runFunctionTask(state, controller.signal, vi.fn())

    expect(result.status).toBe('cancelled')
  })

  it('marks cancelled instead of success when the signal was aborted before a clean resolve', async () => {
    const controller = new AbortController()
    const state = newState(async () => {
      controller.abort()
    })

    const result = await runFunctionTask(state, controller.signal, vi.fn())

    expect(result.status).toBe('cancelled')
  })

  it('passes the signal through to the task body (cooperative cancellation)', async () => {
    const controller = new AbortController()
    let sawAborted = false
    const state = newState(async (_report, signal) => {
      controller.abort()
      sawAborted = signal.aborted
    })

    await runFunctionTask(state, controller.signal, vi.fn())

    expect(sawAborted).toBe(true)
  })
})
