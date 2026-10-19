import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  removeRepo: vi.fn(),
  resolveWorkspaceDir: vi.fn(),
  reconcileWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  SporkError: class SporkError extends Error {},
}))
vi.mock('@spork/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  NotInteractiveError: class NotInteractiveError extends Error {},
}))

const { removeRepo, resolveWorkspaceDir, reconcileWorkspace, listWorkspaces, SporkError } = await import('@spork/core')
const { select, confirm } = await import('@spork/prompts')
const { runRemoveRepo, registerRemoveRepoCommand } = await import('../../src/commands/workspace/removeRepo.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

const manifestWithOneWorktree = {
  manifest: {
    name: 'demo',
    createdAt: '',
    worktrees: [{ folder: 'widgets', source: 'git@github.com:acme/widgets.git', requestedRef: 'HEAD', localBranch: 'demo', addedAt: '' }],
  },
  removedFolders: [],
}

beforeEach(() => {
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(removeRepo).mockReset().mockResolvedValue(undefined)
  vi.mocked(reconcileWorkspace).mockReset().mockResolvedValue(manifestWithOneWorktree)
  vi.mocked(listWorkspaces).mockReset().mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
  vi.mocked(select).mockReset()
  vi.mocked(confirm).mockReset().mockResolvedValue(true)
})

describe('runRemoveRepo', () => {
  it('resolves the workspace and removes the named folder', async () => {
    const result = await runRemoveRepo(ctx, 'demo', 'widgets', { yes: true })

    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(removeRepo).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/ws/demo', 'widgets')
    expect(result).toEqual({ workspace: 'demo', folder: 'widgets' })
  })
})

describe('runRemoveRepo — destructive confirmation', () => {
  it('asks for confirmation before removing, unless --yes was passed', async () => {
    await runRemoveRepo(ctx, 'demo', 'widgets', {})

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('widgets') }))
    expect(removeRepo).toHaveBeenCalled()
  })

  it('throws Cancelled when the user declines the confirmation', async () => {
    vi.mocked(confirm).mockResolvedValue(false)

    await expect(runRemoveRepo(ctx, 'demo', 'widgets', {})).rejects.toThrow(SporkError)
    expect(removeRepo).not.toHaveBeenCalled()
  })
})

describe('runRemoveRepo — picking workspace and folder from a list', () => {
  it('picks the workspace when omitted', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    vi.mocked(select).mockResolvedValueOnce(['demo'])

    const result = await runRemoveRepo(ctx, undefined, 'widgets', { yes: true })

    expect(result.workspace).toBe('demo')
  })

  it('picks the folder when omitted, from the resolved workspace', async () => {
    vi.mocked(select).mockResolvedValue(['widgets'])

    const result = await runRemoveRepo(ctx, 'demo', undefined, { yes: true })

    expect(select).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('demo') }))
    expect(result.folder).toBe('widgets')
  })

  it('refuses when the resolved workspace has no repos to remove', async () => {
    vi.mocked(reconcileWorkspace).mockResolvedValue({ manifest: { name: 'demo', createdAt: '', worktrees: [] }, removedFolders: [] })

    await expect(runRemoveRepo(ctx, 'demo', undefined, { yes: true })).rejects.toThrow(SporkError)
  })
})

describe('registerRemoveRepoCommand', () => {
  it('wires the remove-repo command and prints a confirmation', async () => {
    const program = new Command()
    registerRemoveRepoCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'remove-repo', 'demo', 'widgets', '--yes'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Removed "widgets"')
    logSpy.mockRestore()
  })
})
