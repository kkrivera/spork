import os from 'node:os'
import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  listWorkspacesByRecentUse: vi.fn(),
  readManifest: vi.fn(),
}))

const { listWorkspacesByRecentUse, readManifest } = await import('@spork/core')
const { runList, formatWorkspaceList, registerListCommand } = await import('../../src/commands/workspace/list.js')
const { createUi } = await import('../../src/output/color.js')

const home = os.homedir()
const ctx = {
  reposRoot: '/repos',
  registryPath: '/registry.json',
  repoRegistryPath: '/repos.json',
  ui: createUi({ argv: ['--no-color'] }),
  env: {},
}

function manifestWith(repoCount: number) {
  return { name: 'x', createdAt: '', worktrees: Array.from({ length: repoCount }, () => ({ folder: 'f', source: 's', addedAt: '' })) }
}

beforeEach(() => {
  vi.mocked(listWorkspacesByRecentUse).mockReset()
  vi.mocked(readManifest).mockReset()
})

describe('runList', () => {
  it("adds each workspace's repo count from its manifest", async () => {
    vi.mocked(listWorkspacesByRecentUse).mockResolvedValue([{ name: 'demo', dir: '/ws/demo', lastActivity: null }])
    vi.mocked(readManifest).mockResolvedValue(manifestWith(3) as never)

    expect(await runList(ctx)).toEqual([{ name: 'demo', dir: '/ws/demo', lastActivity: null, repos: 3 }])
    expect(listWorkspacesByRecentUse).toHaveBeenCalledWith('/registry.json')
    expect(readManifest).toHaveBeenCalledWith('/ws/demo')
  })

  it("leaves the count unknown when a manifest can't be read", async () => {
    vi.mocked(listWorkspacesByRecentUse).mockResolvedValue([{ name: 'demo', dir: '/ws/demo', lastActivity: null }])
    vi.mocked(readManifest).mockRejectedValue(new Error('ENOENT'))

    expect(await runList(ctx)).toEqual([{ name: 'demo', dir: '/ws/demo', lastActivity: null, repos: null }])
  })
})

describe('formatWorkspaceList', () => {
  const now = new Date('2026-03-10T12:00:00.000Z')
  const used = { kind: 'used' as const, at: '2026-03-10T09:00:00.000Z' }
  const atDefault = { name: 'kris/demo', dir: `${home}/ws/kris/demo`, repos: 3, lastActivity: used }
  const elsewhere = { name: 'root', dir: `${home}/code`, repos: null, lastActivity: null }
  const fresh = { name: 'new', dir: `${home}/ws/new`, repos: 0, lastActivity: { kind: 'created' as const, at: '2026-02-24T12:00:00.000Z' } }

  it('shows when each was last used (or created) and the folder it sits in', () => {
    expect(formatWorkspaceList([atDefault, fresh, elsewhere], {}, now).split('\n')).toEqual([
      'NAME       REPOS  ACTIVITY               LOCATION',
      'kris/demo  3      Last used 3 hours ago  ~/ws',
      'new        0      Created 2 weeks ago    ~/ws',
      'root       ?                             ~/code',
    ])
  })

  it('shows every full path with --paths', () => {
    expect(formatWorkspaceList([atDefault], { paths: true }, now).split('\n')).toEqual([
      'NAME       REPOS  ACTIVITY               PATH',
      `kris/demo  3      Last used 3 hours ago  ${home}/ws/kris/demo`,
    ])
  })
})

describe('registerListCommand', () => {
  it('prints a table of workspaces', async () => {
    vi.mocked(listWorkspacesByRecentUse).mockResolvedValue([{ name: 'demo', dir: `${home}/ws/demo`, lastActivity: null }])
    vi.mocked(readManifest).mockResolvedValue(manifestWith(1) as never)
    const program = new Command()
    registerListCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'list'])

    expect(logSpy.mock.calls.flat().join('\n')).toBe('NAME  REPOS  ACTIVITY  LOCATION\ndemo  1                ~/ws')
    logSpy.mockRestore()
  })

  it('passes --paths through', async () => {
    vi.mocked(listWorkspacesByRecentUse).mockResolvedValue([{ name: 'demo', dir: `${home}/ws/demo`, lastActivity: null }])
    vi.mocked(readManifest).mockResolvedValue(manifestWith(1) as never)
    const program = new Command()
    registerListCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'list', '--paths'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain(`${home}/ws/demo`)
    logSpy.mockRestore()
  })

  it('prints a helpful message when there are no workspaces', async () => {
    vi.mocked(listWorkspacesByRecentUse).mockResolvedValue([])
    const program = new Command()
    registerListCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'list'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('No workspaces yet')
    logSpy.mockRestore()
  })
})
