import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  listWorkspaces: vi.fn(),
}))

const { listWorkspaces } = await import('@spork/core')
const { runList, registerListCommand } = await import('../../src/commands/workspace/list.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

beforeEach(() => {
  vi.mocked(listWorkspaces).mockReset()
})

describe('runList', () => {
  it('delegates to core listWorkspaces', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])

    expect(await runList(ctx)).toEqual([{ name: 'demo', dir: '/ws/demo' }])
    expect(listWorkspaces).toHaveBeenCalledWith('/registry.json')
  })
})

describe('registerListCommand', () => {
  it('prints a table of workspaces', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    const program = new Command()
    registerListCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'list'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('demo')
    logSpy.mockRestore()
  })

  it('prints a helpful message when there are no workspaces', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([])
    const program = new Command()
    registerListCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'list'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('No workspaces yet')
    logSpy.mockRestore()
  })
})
