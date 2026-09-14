import { describe, expect, it, vi, beforeEach } from 'vitest'

const execFileMock = vi.fn()

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const callback = args[args.length - 1] as (error: unknown, result: unknown) => void
    execFileMock(...args.slice(0, -1))
      .then((result: unknown) => callback(null, result))
      .catch((error: unknown) => callback(error, null))
  },
}))

const { createCodeOpener } = await import('../src/opener.js')

beforeEach(() => {
  execFileMock.mockReset()
})

describe('createCodeOpener', () => {
  it('launches the code CLI with the given path', async () => {
    execFileMock.mockResolvedValue({ stdout: '', stderr: '' })

    const outcome = await createCodeOpener().open('/ws/demo/demo.code-workspace')

    expect(outcome).toEqual({ ok: true })
    expect(execFileMock).toHaveBeenCalledWith('code', ['/ws/demo/demo.code-workspace'])
  })

  it('reports a failure reason when the code CLI is not found', async () => {
    execFileMock.mockRejectedValue(new Error('spawn code ENOENT'))

    const outcome = await createCodeOpener().open('/ws/demo/demo.code-workspace')

    expect(outcome).toEqual({ ok: false, reason: 'spawn code ENOENT' })
  })

  it('stringifies a non-Error rejection', async () => {
    execFileMock.mockRejectedValue('boom')

    const outcome = await createCodeOpener().open('/ws/demo/demo.code-workspace')

    expect(outcome).toEqual({ ok: false, reason: 'boom' })
  })
})
