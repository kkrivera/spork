import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  listWorkspaces: vi.fn(),
  removeWorkspace: vi.fn(),
  resolveWorkspaceDir: vi.fn(),
  unregisterWorkspace: vi.fn(),
}))

const { listWorkspaces, removeWorkspace, resolveWorkspaceDir, unregisterWorkspace } = await import('@spork/core')
const { runRemove, registerRemoveCommand } = await import('../../src/commands/workspace/remove.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

beforeEach(() => {
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(removeWorkspace).mockReset().mockResolvedValue(undefined)
  vi.mocked(listWorkspaces).mockReset().mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
  vi.mocked(unregisterWorkspace).mockReset().mockResolvedValue(undefined)
})

describe('runRemove', () => {
  it('removes the workspace and unregisters its matching registry entry', async () => {
    await runRemove(ctx, 'demo', {})

    expect(removeWorkspace).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/ws/demo', { keepFiles: undefined })
    expect(unregisterWorkspace).toHaveBeenCalledWith('/registry.json', 'demo')
  })

  it('forwards keepFiles', async () => {
    await runRemove(ctx, 'demo', { keepFiles: true })

    expect(removeWorkspace).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/ws/demo', { keepFiles: true })
  })

  it('does not try to unregister when nothing in the registry matches the resolved dir', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([])

    await runRemove(ctx, '/ws/demo', {})

    expect(unregisterWorkspace).not.toHaveBeenCalled()
  })
})

describe('registerRemoveCommand', () => {
  it('wires the remove command and prints a confirmation', async () => {
    const program = new Command()
    registerRemoveCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'remove', 'demo', '--keep-files'])

    expect(removeWorkspace).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/ws/demo', { keepFiles: true })
    expect(logSpy.mock.calls.flat().join('\n')).toContain('Removed workspace "demo"')
    logSpy.mockRestore()
  })
})
