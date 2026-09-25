import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Opener } from '../../src/opener.js'

vi.mock('@spork/core', () => ({
  codeWorkspaceFilePath: vi.fn(),
  reconcileWorkspace: vi.fn(),
  resolveWorkspaceDir: vi.fn(),
}))

const { codeWorkspaceFilePath, reconcileWorkspace, resolveWorkspaceDir } = await import('@spork/core')
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
})
