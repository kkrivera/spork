import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  listRepoAliases: vi.fn(),
}))

const { listRepoAliases } = await import('@spork/core')
const { runList, registerListCommand } = await import('../../src/commands/repo/list.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/workspaces.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

beforeEach(() => {
  vi.mocked(listRepoAliases).mockReset()
})

describe('runList', () => {
  it('delegates to core listRepoAliases with repoRegistryPath and reposRoot', async () => {
    vi.mocked(listRepoAliases).mockResolvedValue([{ alias: 'widgets', source: 'x', addedAt: '' }])

    expect(await runList(ctx)).toEqual([{ alias: 'widgets', source: 'x', addedAt: '' }])
    expect(listRepoAliases).toHaveBeenCalledWith('/repos.json', '/repos')
  })
})

describe('registerListCommand', () => {
  it('prints a table of aliases', async () => {
    vi.mocked(listRepoAliases).mockResolvedValue([{ alias: 'widgets', source: 'git@x:widgets.git', addedAt: '' }])
    const program = new Command()
    registerListCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'list'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('widgets')
    logSpy.mockRestore()
  })

  it('prints a helpful message when there are no repos', async () => {
    vi.mocked(listRepoAliases).mockResolvedValue([])
    const program = new Command()
    registerListCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'list'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('No repos yet')
    logSpy.mockRestore()
  })
})
