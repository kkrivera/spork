import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Opener } from '../../src/opener.js'

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
const { runOpen, registerOpenCommand } = await import('../../src/commands/workspace/open.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

function fakeOpener(outcome: Awaited<ReturnType<Opener['open']>>): Opener {
  return { open: vi.fn().mockResolvedValue(outcome) }
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

describe('runOpen', () => {
  it('resolves the workspace, then opens its .code-workspace file', async () => {
    const opener = fakeOpener({ ok: true })

    const result = await runOpen(ctx, 'demo', opener)

    expect(codeWorkspaceFilePath).toHaveBeenCalledWith('/ws/demo', 'demo')
    expect(opener.open).toHaveBeenCalledWith('/ws/demo/demo.code-workspace')
    expect(result).toEqual({ filePath: '/ws/demo/demo.code-workspace', opened: true, reason: undefined })
  })

  it('surfaces a failure reason when the opener fails', async () => {
    const opener = fakeOpener({ ok: false, reason: 'command not found: code' })

    const result = await runOpen(ctx, 'demo', opener)

    expect(result).toEqual({
      filePath: '/ws/demo/demo.code-workspace',
      opened: false,
      reason: 'command not found: code',
    })
  })
})

describe('runOpen — picking from a list (no workspace name given)', () => {
  it('offers a single-select of registered workspaces and opens the chosen one', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([
      { name: 'demo', dir: '/ws/demo' },
      { name: 'other', dir: '/ws/other' },
    ])
    vi.mocked(select).mockResolvedValue(['other'])
    vi.mocked(resolveWorkspaceDir).mockResolvedValue('/ws/other')
    vi.mocked(reconcileWorkspace).mockResolvedValue({
      manifest: { name: 'other', createdAt: '', worktrees: [] },
      removedFolders: [],
    })
    const opener = fakeOpener({ ok: true })

    const result = await runOpen(ctx, undefined, opener)

    expect(select).toHaveBeenCalledWith(expect.objectContaining({ mode: 'single' }))
    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'other')
    expect(reconcileWorkspace).toHaveBeenCalledWith(expect.anything(), '/ws/other')
    expect(result.opened).toBe(true)
  })

  it('refuses with a clear error when nothing is registered yet', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([])

    await expect(runOpen(ctx, undefined, fakeOpener({ ok: true }))).rejects.toThrow(SporkError)
    expect(select).not.toHaveBeenCalled()
  })

  it('auto-detects the enclosing workspace from cwd, without prompting', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])

    const result = await runOpen(ctx, undefined, fakeOpener({ ok: true }))

    expect(select).not.toHaveBeenCalled()
    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(result.opened).toBe(true)
  })

  it('throws Cancelled when the user backs out of the picker', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    vi.mocked(select).mockResolvedValue(null)

    await expect(runOpen(ctx, undefined, fakeOpener({ ok: true }))).rejects.toThrow(SporkError)
  })

  it('asks for an explicit name when the terminal cannot support a prompt', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    vi.mocked(select).mockRejectedValue(new NotInteractiveError())

    const error: unknown = await runOpen(ctx, undefined, fakeOpener({ ok: true })).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SporkError)
    expect((error as Error).message).toContain('spork workspace open <name>')
  })

  it('re-throws a real picker failure rather than swallowing it', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    vi.mocked(select).mockRejectedValue(new Error('terminal exploded'))

    await expect(runOpen(ctx, undefined, fakeOpener({ ok: true }))).rejects.toThrow('terminal exploded')
  })
})

describe('registerOpenCommand', () => {
  it('prints a success message when the opener succeeds', async () => {
    const program = new Command()
    registerOpenCommand(program, ctx, fakeOpener({ ok: true }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'open', 'demo'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Opened /ws/demo/demo.code-workspace')
    logSpy.mockRestore()
  })

  it('prints a manual fallback when the opener fails', async () => {
    const program = new Command()
    registerOpenCommand(program, ctx, fakeOpener({ ok: false, reason: 'not found' }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'open', 'demo'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('not found')
    expect(output).toContain('Open manually')
    logSpy.mockRestore()
  })

  it('accepts no workspace name, picking from the list instead', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    vi.mocked(select).mockResolvedValue(['demo'])
    const program = new Command()
    registerOpenCommand(program, ctx, fakeOpener({ ok: true }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'open'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Opened')
    logSpy.mockRestore()
  })
})
