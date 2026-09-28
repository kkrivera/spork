import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  listRepoAliases: vi.fn(),
  findEnclosingWorkspaceDir: vi.fn(),
  localRepoRegistryPath: (workspaceDir: string) => `${workspaceDir}/spork.repos.json`,
  SporkError: class SporkError extends Error {},
}))

const { listRepoAliases, findEnclosingWorkspaceDir } = await import('@spork/core')
const { runList, registerListCommand } = await import('../../src/commands/repo/list.js')
const { createUi } = await import('../../src/output/color.js')
const { SporkError } = await import('@spork/core')

const ctx = { reposRoot: '/repos', registryPath: '/workspaces.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

beforeEach(() => {
  vi.mocked(listRepoAliases).mockReset()
  vi.mocked(findEnclosingWorkspaceDir).mockReset().mockReturnValue(null)
})

describe('runList', () => {
  it('returns only global entries, tagged, when outside any workspace', async () => {
    vi.mocked(listRepoAliases).mockResolvedValue([{ alias: 'widgets', source: 'x', addedAt: '' }])

    const result = await runList(ctx)

    expect(result).toEqual([{ alias: 'widgets', source: 'x', addedAt: '', scope: 'global' }])
    expect(listRepoAliases).toHaveBeenCalledWith('/repos.json', '/repos')
  })

  it('merges local and global entries, each tagged, when inside a workspace', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')
    vi.mocked(listRepoAliases).mockImplementation(async (registryPath: string) => {
      if (registryPath === '/ws/demo/spork.repos.json') return [{ alias: 'api', source: 'local-x', addedAt: '' }]
      return [{ alias: 'widgets', source: 'global-x', addedAt: '' }]
    })

    const result = await runList(ctx)

    expect(result).toEqual([
      { alias: 'api', source: 'local-x', addedAt: '', scope: 'local' },
      { alias: 'widgets', source: 'global-x', addedAt: '', scope: 'global' },
    ])
  })

  it('--global narrows to only global entries even when inside a workspace', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')
    vi.mocked(listRepoAliases).mockResolvedValue([{ alias: 'widgets', source: 'global-x', addedAt: '' }])

    const result = await runList(ctx, { global: true })

    expect(result).toEqual([{ alias: 'widgets', source: 'global-x', addedAt: '', scope: 'global' }])
    expect(listRepoAliases).toHaveBeenCalledTimes(1)
  })

  it('--local narrows to only local entries', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')
    vi.mocked(listRepoAliases).mockResolvedValue([{ alias: 'api', source: 'local-x', addedAt: '' }])

    const result = await runList(ctx, { local: true })

    expect(result).toEqual([{ alias: 'api', source: 'local-x', addedAt: '', scope: 'local' }])
    expect(listRepoAliases).toHaveBeenCalledTimes(1)
  })

  it('--local outside any workspace is a SporkError', async () => {
    await expect(runList(ctx, { local: true })).rejects.toThrow(SporkError)
  })

  it('passing both --global and --local is a SporkError', async () => {
    await expect(runList(ctx, { global: true, local: true })).rejects.toThrow(SporkError)
  })
})

describe('registerListCommand', () => {
  it('prints a table of aliases including a SCOPE column', async () => {
    vi.mocked(listRepoAliases).mockResolvedValue([{ alias: 'widgets', source: 'git@x:widgets.git', addedAt: '' }])
    const program = new Command()
    registerListCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'list'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('widgets')
    expect(output).toContain('SCOPE')
    expect(output).toContain('global')
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
