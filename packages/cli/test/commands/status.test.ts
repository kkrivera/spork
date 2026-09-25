import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  getWorkspaceStatus: vi.fn(),
  resolveWorkspaceDir: vi.fn(),
}))

const { getWorkspaceStatus, resolveWorkspaceDir } = await import('@spork/core')
const { runStatus, registerStatusCommand } = await import('../../src/commands/workspace/status.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

beforeEach(() => {
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(getWorkspaceStatus).mockReset()
})

describe('runStatus', () => {
  it('resolves the workspace and returns its worktree statuses', async () => {
    vi.mocked(getWorkspaceStatus).mockResolvedValue([])

    await runStatus(ctx, 'demo')

    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(getWorkspaceStatus).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/ws/demo')
  })
})

describe('registerStatusCommand', () => {
  it('prints a table with branch and dirty state', async () => {
    vi.mocked(getWorkspaceStatus).mockResolvedValue([
      {
        folder: 'widgets',
        source: 'x',
        requestedRef: 'main',
        localBranch: 'spork/demo/widgets',
        addedAt: '',
        status: { branch: 'spork/demo/widgets', isClean: false, changedFiles: 3 },
      },
    ])
    const program = new Command()
    registerStatusCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'status', 'demo'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('widgets')
    expect(output).toContain('3 changed')
    logSpy.mockRestore()
  })

  it('reports a detached worktree distinctly', async () => {
    vi.mocked(getWorkspaceStatus).mockResolvedValue([
      {
        folder: 'widgets',
        source: 'x',
        requestedRef: 'main',
        localBranch: 'spork/demo/widgets',
        addedAt: '',
        status: { branch: null, isClean: true, changedFiles: 0 },
      },
    ])
    const program = new Command()
    registerStatusCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'status', 'demo'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('(detached)')
    logSpy.mockRestore()
  })

  it('prints a helpful message for a workspace with no repos', async () => {
    vi.mocked(getWorkspaceStatus).mockResolvedValue([])
    const program = new Command()
    registerStatusCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'status', 'demo'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('no repos yet')
    logSpy.mockRestore()
  })
})
