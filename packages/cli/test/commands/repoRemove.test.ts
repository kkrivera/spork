import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  removeRepoSource: vi.fn(),
}))

const { removeRepoSource } = await import('@spork/core')
const { runRemove, registerRemoveCommand } = await import('../../src/commands/repo/remove.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/workspaces.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

beforeEach(() => {
  vi.mocked(removeRepoSource).mockReset().mockResolvedValue(undefined)
})

describe('runRemove', () => {
  it('forwards the alias with the full remove context, including the workspace registry path', async () => {
    await runRemove(ctx, 'widgets')

    expect(removeRepoSource).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/repos.json', workspaceRegistryPath: '/workspaces.json' },
      'widgets',
    )
  })
})

describe('registerRemoveCommand', () => {
  it('wires the remove command and prints a confirmation', async () => {
    const program = new Command()
    registerRemoveCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'remove', 'widgets'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Removed "widgets"')
    logSpy.mockRestore()
  })
})
