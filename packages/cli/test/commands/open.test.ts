import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaunchDeps } from '../../src/launchTarget.js'

vi.mock('@spork/core', () => ({
  codeWorkspaceFilePath: vi.fn(),
  reconcileWorkspace: vi.fn(),
  resolveWorkspaceDir: vi.fn(),
  listWorkspaces: vi.fn(),
  findEnclosingWorkspaceDir: vi.fn(),
  SporkError: class SporkError extends Error {},
}))
vi.mock('@spork/prompts', () => ({
  select: vi.fn(),
  NotInteractiveError: class NotInteractiveError extends Error {},
}))

const { codeWorkspaceFilePath, reconcileWorkspace, resolveWorkspaceDir, listWorkspaces, findEnclosingWorkspaceDir, SporkError } =
  await import('@spork/core')
const { select, NotInteractiveError } = await import('@spork/prompts')
const { runOpen, parseLaunchTarget, registerOpenCommand } = await import('../../src/commands/workspace/open.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }), env: {} }

function fakeDeps(openOutcome: { ok: boolean; reason?: string }, claudeImpl?: () => Promise<unknown>): LaunchDeps {
  return {
    opener: { open: vi.fn().mockResolvedValue(openOutcome) },
    executor: { run: vi.fn().mockImplementation(claudeImpl ?? (async () => ({ exitCode: 0, signal: null }))) },
  }
}

beforeEach(() => {
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(reconcileWorkspace)
    .mockReset()
    .mockResolvedValue({ manifest: { name: 'demo', createdAt: '', worktrees: [] }, removedFolders: [] })
  vi.mocked(codeWorkspaceFilePath).mockReset().mockReturnValue('/ws/demo/demo.code-workspace')
  vi.mocked(listWorkspaces).mockReset().mockResolvedValue([])
  vi.mocked(findEnclosingWorkspaceDir).mockReset().mockReturnValue(null)
  vi.mocked(select).mockReset()
})

describe('parseLaunchTarget', () => {
  it('accepts code/claude', () => {
    expect(parseLaunchTarget('code')).toBe('code')
    expect(parseLaunchTarget('claude')).toBe('claude')
  })

  it('rejects anything else', () => {
    expect(() => parseLaunchTarget('vim')).toThrow(SporkError)
  })
})

describe('runOpen', () => {
  it('resolves the workspace, then opens its .code-workspace file with --with code', async () => {
    const deps = fakeDeps({ ok: true })

    const result = await runOpen(ctx, 'demo', { with: 'code' }, deps)

    expect(codeWorkspaceFilePath).toHaveBeenCalledWith('/ws/demo', 'demo')
    expect(deps.opener.open).toHaveBeenCalledWith('/ws/demo/demo.code-workspace')
    expect(select).not.toHaveBeenCalled()
    expect(result).toEqual({ filePath: '/ws/demo/demo.code-workspace', dir: '/ws/demo', target: 'code', opened: true, reason: undefined })
  })

  it('launches claude cwd’d into the workspace directory with --with claude', async () => {
    const deps = fakeDeps({ ok: true })

    const result = await runOpen(ctx, 'demo', { with: 'claude' }, deps)

    expect(deps.executor.run).toHaveBeenCalledWith('claude', '/ws/demo')
    expect(deps.opener.open).not.toHaveBeenCalled()
    expect(result.target).toBe('claude')
    expect(result.opened).toBe(true)
  })

  it('surfaces a failure reason when the code opener fails', async () => {
    const deps = fakeDeps({ ok: false, reason: 'command not found: code' })

    const result = await runOpen(ctx, 'demo', { with: 'code' }, deps)

    expect(result.opened).toBe(false)
    expect(result.reason).toBe('command not found: code')
  })

  it('surfaces a failure reason when claude fails to even spawn', async () => {
    const deps = fakeDeps({ ok: true }, async () => {
      throw new Error('spawn claude ENOENT')
    })

    const result = await runOpen(ctx, 'demo', { with: 'claude' }, deps)

    expect(result.opened).toBe(false)
    expect(result.reason).toBe('spawn claude ENOENT')
  })
})

describe('runOpen — picking a target (no --with given)', () => {
  it('prompts a single-select of code/claude and uses whichever was chosen', async () => {
    vi.mocked(select).mockResolvedValue(['claude'])
    const deps = fakeDeps({ ok: true })

    const result = await runOpen(ctx, 'demo', {}, deps)

    expect(select).toHaveBeenCalledWith(expect.objectContaining({ mode: 'single' }))
    expect(result.target).toBe('claude')
  })

  it('throws Cancelled when the user backs out of the target picker', async () => {
    vi.mocked(select).mockResolvedValue(null)

    await expect(runOpen(ctx, 'demo', {}, fakeDeps({ ok: true }))).rejects.toThrow(SporkError)
  })

  it('demands --with when there is no interactive terminal', async () => {
    vi.mocked(select).mockRejectedValue(new NotInteractiveError())

    const error: unknown = await runOpen(ctx, 'demo', {}, fakeDeps({ ok: true })).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SporkError)
    expect((error as Error).message).toContain('--with')
  })

  it('re-throws a real target-picker failure rather than swallowing it', async () => {
    vi.mocked(select).mockRejectedValue(new Error('terminal exploded'))

    await expect(runOpen(ctx, 'demo', {}, fakeDeps({ ok: true }))).rejects.toThrow('terminal exploded')
  })
})

describe('runOpen — picking a workspace from a list (no workspace name given)', () => {
  it('offers a single-select of registered workspaces and opens the chosen one', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([
      { name: 'demo', dir: '/ws/demo' },
      { name: 'other', dir: '/ws/other' },
    ])
    vi.mocked(select).mockResolvedValueOnce(['other']).mockResolvedValueOnce(['code'])
    vi.mocked(resolveWorkspaceDir).mockResolvedValue('/ws/other')
    vi.mocked(reconcileWorkspace).mockResolvedValue({
      manifest: { name: 'other', createdAt: '', worktrees: [] },
      removedFolders: [],
    })

    const result = await runOpen(ctx, undefined, {}, fakeDeps({ ok: true }))

    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'other')
    expect(reconcileWorkspace).toHaveBeenCalledWith(expect.anything(), '/ws/other')
    expect(result.opened).toBe(true)
  })

  it('refuses with a clear error when nothing is registered yet', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([])

    await expect(runOpen(ctx, undefined, {}, fakeDeps({ ok: true }))).rejects.toThrow(SporkError)
  })

  it('auto-detects the enclosing workspace from cwd, without prompting for which workspace', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])

    const result = await runOpen(ctx, undefined, { with: 'code' }, fakeDeps({ ok: true }))

    expect(select).not.toHaveBeenCalled()
    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(result.opened).toBe(true)
  })
})

describe('registerOpenCommand', () => {
  it('prints a success message for --with code', async () => {
    const program = new Command()
    registerOpenCommand(program, ctx, fakeDeps({ ok: true }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'open', 'demo', '--with', 'code'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Opened /ws/demo/demo.code-workspace')
    logSpy.mockRestore()
  })

  it('prints nothing extra after a successful --with claude launch', async () => {
    const program = new Command()
    registerOpenCommand(program, ctx, fakeDeps({ ok: true }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'open', 'demo', '--with', 'claude'])

    expect(logSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it('prints a manual fallback when the code opener fails', async () => {
    const program = new Command()
    registerOpenCommand(program, ctx, fakeDeps({ ok: false, reason: 'not found' }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'open', 'demo', '--with', 'code'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('not found')
    expect(output).toContain('Open manually')
    logSpy.mockRestore()
  })

})

describe('registerOpenCommand — more failures / flags', () => {
  it('prints a manual fallback when claude fails to launch', async () => {
    const deps = fakeDeps({ ok: true }, async () => {
      throw new Error('boom')
    })
    const program = new Command()
    registerOpenCommand(program, ctx, deps)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'open', 'demo', '--with', 'claude'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('boom')
    expect(output).toContain('cd /ws/demo && claude')
    logSpy.mockRestore()
  })

  it('rejects an invalid --with value before doing anything else', async () => {
    const program = new Command()
    registerOpenCommand(program, ctx, fakeDeps({ ok: true }))

    await expect(program.parseAsync(['node', 'test', 'open', 'demo', '--with', 'vim'])).rejects.toThrow(SporkError)
  })

  it('accepts no workspace name, picking from the list instead', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    vi.mocked(select).mockResolvedValueOnce(['demo']).mockResolvedValueOnce(['code'])
    const program = new Command()
    registerOpenCommand(program, ctx, fakeDeps({ ok: true }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'open'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Opened')
    logSpy.mockRestore()
  })
})
