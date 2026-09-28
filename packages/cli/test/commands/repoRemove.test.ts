import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  removeRepoSource: vi.fn(),
  removeLocalRepoAlias: vi.fn(),
  findEnclosingWorkspaceDir: vi.fn(),
  localRepoRegistryPath: (workspaceDir: string) => `${workspaceDir}/spork.repos.json`,
  SporkError: class SporkError extends Error {},
}))

const { removeRepoSource, removeLocalRepoAlias, findEnclosingWorkspaceDir } = await import('@spork/core')
const { runRemove, registerRemoveCommand } = await import('../../src/commands/repo/remove.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/workspaces.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

beforeEach(() => {
  vi.mocked(removeRepoSource).mockReset().mockResolvedValue(undefined)
  vi.mocked(removeLocalRepoAlias).mockReset().mockResolvedValue(undefined)
  vi.mocked(findEnclosingWorkspaceDir).mockReset().mockReturnValue(null)
})

describe('runRemove', () => {
  it('removes globally when outside any workspace', async () => {
    const scopeLabel = await runRemove(ctx, 'widgets', {})

    expect(removeRepoSource).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/repos.json', workspaceRegistryPath: '/workspaces.json' },
      'widgets',
    )
    expect(removeLocalRepoAlias).not.toHaveBeenCalled()
    expect(scopeLabel).toBe('global')
  })

  it('removes locally by default when inside a workspace', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')

    const scopeLabel = await runRemove(ctx, 'widgets', {})

    expect(removeLocalRepoAlias).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/repos.json', workspaceRegistryPath: '/workspaces.json' },
      '/ws/demo',
      'widgets',
    )
    expect(removeRepoSource).not.toHaveBeenCalled()
    expect(scopeLabel).toBe('local to "demo"')
  })
})

describe('registerRemoveCommand', () => {
  it('wires the remove command and prints a confirmation with scope', async () => {
    const program = new Command()
    registerRemoveCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'remove', 'widgets'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Removed "widgets" (global)')
    logSpy.mockRestore()
  })
})
