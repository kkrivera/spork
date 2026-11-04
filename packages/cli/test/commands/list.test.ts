import os from 'node:os'
import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  listWorkspaces: vi.fn(),
  readManifest: vi.fn(),
}))

const { listWorkspaces, readManifest } = await import('@spork/core')
const { runList, formatWorkspaceList, registerListCommand } = await import('../../src/commands/workspace/list.js')
const { createUi } = await import('../../src/output/color.js')

const home = os.homedir()
const ctx = {
  reposRoot: '/repos',
  registryPath: '/registry.json',
  repoRegistryPath: '/repos.json',
  ui: createUi({ argv: ['--no-color'] }),
  env: { workspaceDir: `${home}/ws` },
}

function manifestWith(repoCount: number) {
  return { name: 'x', createdAt: '', worktrees: Array.from({ length: repoCount }, () => ({ folder: 'f', source: 's', addedAt: '' })) }
}

beforeEach(() => {
  vi.mocked(listWorkspaces).mockReset()
  vi.mocked(readManifest).mockReset()
})

describe('runList', () => {
  it("adds each workspace's repo count from its manifest", async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    vi.mocked(readManifest).mockResolvedValue(manifestWith(3) as never)

    expect(await runList(ctx)).toEqual([{ name: 'demo', dir: '/ws/demo', repos: 3 }])
    expect(listWorkspaces).toHaveBeenCalledWith('/registry.json')
    expect(readManifest).toHaveBeenCalledWith('/ws/demo')
  })

  it("leaves the count unknown when a manifest can't be read", async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    vi.mocked(readManifest).mockRejectedValue(new Error('ENOENT'))

    expect(await runList(ctx)).toEqual([{ name: 'demo', dir: '/ws/demo', repos: null }])
  })
})

describe('formatWorkspaceList', () => {
  const atDefault = { name: 'kris/demo', dir: `${home}/ws/kris/demo`, repos: 3 }
  const elsewhere = { name: 'root', dir: `${home}/code`, repos: null }

  it('leaves out the location column when every workspace is in the default place', () => {
    expect(formatWorkspaceList([atDefault], `${home}/ws`, {})).toBe('NAME       REPOS\nkris/demo  3')
  })

  it('shows a shortened location only for workspaces elsewhere', () => {
    expect(formatWorkspaceList([atDefault, elsewhere], `${home}/ws`, {}).split('\n')).toEqual([
      'NAME       REPOS  LOCATION',
      'kris/demo  3',
      'root       ?      ~/code',
    ])
  })

  it('shows every full path with --paths', () => {
    expect(formatWorkspaceList([atDefault], `${home}/ws`, { paths: true }).split('\n')).toEqual([
      'NAME       REPOS  PATH',
      `kris/demo  3      ${home}/ws/kris/demo`,
    ])
  })
})

describe('registerListCommand', () => {
  it('prints a table of workspaces', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: `${home}/ws/demo` }])
    vi.mocked(readManifest).mockResolvedValue(manifestWith(1) as never)
    const program = new Command()
    registerListCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'list'])

    expect(logSpy.mock.calls.flat().join('\n')).toBe('NAME  REPOS\ndemo  1')
    logSpy.mockRestore()
  })

  it('passes --paths through', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: `${home}/ws/demo` }])
    vi.mocked(readManifest).mockResolvedValue(manifestWith(1) as never)
    const program = new Command()
    registerListCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'list', '--paths'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain(`${home}/ws/demo`)
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
