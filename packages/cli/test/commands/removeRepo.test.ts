import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  removeRepo: vi.fn(),
  resolveWorkspaceDir: vi.fn(),
}))

const { removeRepo, resolveWorkspaceDir } = await import('@spork/core')
const { runRemoveRepo, registerRemoveRepoCommand } = await import('../../src/commands/workspace/removeRepo.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

beforeEach(() => {
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(removeRepo).mockReset().mockResolvedValue(undefined)
})

describe('runRemoveRepo', () => {
  it('resolves the workspace and removes the named folder', async () => {
    await runRemoveRepo(ctx, 'demo', 'widgets')

    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(removeRepo).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/ws/demo', 'widgets')
  })
})

describe('registerRemoveRepoCommand', () => {
  it('wires the remove-repo command and prints a confirmation', async () => {
    const program = new Command()
    registerRemoveRepoCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'remove-repo', 'demo', 'widgets'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Removed "widgets"')
    logSpy.mockRestore()
  })
})
