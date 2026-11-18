import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/shellIntegrationOffer.js', () => ({ offerShellIntegration: vi.fn(async () => {}) }))

const { offerShellIntegration } = await import('../src/shellIntegrationOffer.js')
const { defaultTerminalDeps, openInTerminal } = await import('../src/terminalTarget.js')
const { launchFailureMessage, launchWorkspace } = await import('../src/launchTarget.js')
const { createUi } = await import('../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }), env: {} }

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'spork-terminal-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function executor(impl: () => Promise<unknown> = async () => ({ exitCode: 0, signal: null })) {
  return { run: vi.fn().mockImplementation(impl) }
}

describe('openInTerminal', () => {
  it('hands the folder to the shell integration through SPORK_CD_FILE, starting nothing', async () => {
    const cdFile = path.join(dir, 'cd')
    const run = executor()
    const beforeShell = vi.fn(async () => {})

    expect(await openInTerminal('/ws/demo', run, { cdFile, isInteractive: () => false, beforeShell })).toEqual({ ok: true })

    expect(await readFile(cdFile, 'utf8')).toBe('/ws/demo')
    expect(run.run).not.toHaveBeenCalled()
    expect(beforeShell).not.toHaveBeenCalled()
  })

  it("otherwise starts the user's shell in the folder, after the offer", async () => {
    const run = executor()
    const order: string[] = []
    const beforeShell = vi.fn(async () => void order.push('offer'))
    run.run.mockImplementation(async () => void order.push('shell'))

    expect(await openInTerminal('/ws/demo', run, { isInteractive: () => true, beforeShell })).toEqual({ ok: true })

    expect(run.run).toHaveBeenCalledWith('exec "${SHELL:-/bin/sh}"', '/ws/demo')
    expect(beforeShell).toHaveBeenCalledWith('/ws/demo')
    expect(order).toEqual(['offer', 'shell'])
  })

  it('refuses without a terminal to run a shell in', async () => {
    const run = executor()

    expect(await openInTerminal('/ws/demo', run, { isInteractive: () => false, beforeShell: vi.fn() })).toEqual({
      ok: false,
      reason: 'not running in an interactive terminal',
    })
    expect(run.run).not.toHaveBeenCalled()
  })

  it('reports a shell that fails to start, or a cd file it cannot write', async () => {
    const failing = executor(async () => {
      throw new Error('spawn ENOENT')
    })
    expect(await openInTerminal('/ws', failing, { isInteractive: () => true, beforeShell: async () => {} })).toEqual({
      ok: false,
      reason: 'spawn ENOENT',
    })

    const outcome = await openInTerminal('/ws', executor(), {
      cdFile: path.join(dir, 'missing', 'cd'),
      isInteractive: () => true,
      beforeShell: async () => {},
    })
    expect(outcome.ok).toBe(false)
  })
})

describe('defaultTerminalDeps', () => {
  it('takes SPORK_CD_FILE from the context, and offers the integration before saying how to get back', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const deps = defaultTerminalDeps({ ...ctx, env: { cdFile: '/tmp/cd' } })

    await deps.beforeShell('/ws/demo')

    expect(deps.cdFile).toBe('/tmp/cd')
    expect(typeof deps.isInteractive()).toBe('boolean')
    expect(offerShellIntegration).toHaveBeenCalled()
    expect(logSpy.mock.calls.flat().join('\n')).toBe('Opening a new shell in /ws/demo. Type exit to come back.')
  })
})

describe('launchWorkspace / launchFailureMessage — terminal', () => {
  it('routes "terminal" to openInTerminal', async () => {
    const cdFile = path.join(dir, 'cd')
    const deps = { opener: { open: vi.fn() }, executor: executor(), terminal: { cdFile, isInteractive: () => true, beforeShell: vi.fn() } }

    expect(await launchWorkspace('terminal', '/ws/demo', '/ws/demo/demo.code-workspace', deps)).toEqual({ ok: true })
    expect(await readFile(cdFile, 'utf8')).toBe('/ws/demo')
    expect(deps.opener.open).not.toHaveBeenCalled()
  })

  it('says how to get there by hand', () => {
    expect(launchFailureMessage('terminal', '/ws/demo', 'no tty')).toBe("Couldn't open a shell (no tty). Go there with: cd /ws/demo")
    expect(launchFailureMessage('claude', '/ws/demo', 'boom')).toBe("Couldn't launch Claude (boom). Run it yourself: cd /ws/demo && claude")
  })
})
