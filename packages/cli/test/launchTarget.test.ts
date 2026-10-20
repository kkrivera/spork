import { describe, expect, it, vi } from 'vitest'
import { launchWorkspace, type LaunchDeps } from '../src/launchTarget.js'

function fakeDeps(openOutcome: { ok: boolean; reason?: string }, claudeImpl?: () => Promise<unknown>): LaunchDeps {
  return {
    opener: { open: vi.fn().mockResolvedValue(openOutcome) },
    executor: { run: vi.fn().mockImplementation(claudeImpl ?? (async () => ({ exitCode: 0, signal: null }))) },
  }
}

describe('launchWorkspace', () => {
  it('opens the .code-workspace file via the Opener for "code"', async () => {
    const deps = fakeDeps({ ok: true })

    const outcome = await launchWorkspace('code', '/ws/demo', '/ws/demo/demo.code-workspace', deps)

    expect(deps.opener.open).toHaveBeenCalledWith('/ws/demo/demo.code-workspace')
    expect(deps.executor.run).not.toHaveBeenCalled()
    expect(outcome).toEqual({ ok: true })
  })

  it('surfaces the Opener’s own failure reason for "code"', async () => {
    const deps = fakeDeps({ ok: false, reason: 'command not found: code' })

    const outcome = await launchWorkspace('code', '/ws/demo', '/ws/demo/demo.code-workspace', deps)

    expect(outcome).toEqual({ ok: false, reason: 'command not found: code' })
  })

  it('runs claude cwd’d into the workspace directory for "claude"', async () => {
    const deps = fakeDeps({ ok: true })

    const outcome = await launchWorkspace('claude', '/ws/demo', '/ws/demo/demo.code-workspace', deps)

    expect(deps.executor.run).toHaveBeenCalledWith('claude', '/ws/demo')
    expect(deps.opener.open).not.toHaveBeenCalled()
    expect(outcome).toEqual({ ok: true })
  })

  it('does not treat a non-zero exit/signal from a real claude session as a failure', async () => {
    const deps = fakeDeps({ ok: true }, async () => ({ exitCode: 1, signal: null }))

    const outcome = await launchWorkspace('claude', '/ws/demo', '/ws/demo/demo.code-workspace', deps)

    expect(outcome).toEqual({ ok: true })
  })

  it('reports a genuine failure to spawn claude at all', async () => {
    const deps = fakeDeps({ ok: true }, async () => {
      throw new Error('spawn claude ENOENT')
    })

    const outcome = await launchWorkspace('claude', '/ws/demo', '/ws/demo/demo.code-workspace', deps)

    expect(outcome).toEqual({ ok: false, reason: 'spawn claude ENOENT' })
  })

  it('stringifies a non-Error rejection', async () => {
    const deps = fakeDeps({ ok: true }, async () => {
      throw 'not an Error instance'
    })

    const outcome = await launchWorkspace('claude', '/ws/demo', '/ws/demo/demo.code-workspace', deps)

    expect(outcome).toEqual({ ok: false, reason: 'not an Error instance' })
  })
})
