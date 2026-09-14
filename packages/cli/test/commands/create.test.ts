import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  createWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  registerWorkspace: vi.fn(),
  SporkError: class SporkError extends Error {},
}))

const { createWorkspace, listWorkspaces, registerWorkspace, SporkError } = await import('@spork/core')
const { runCreate, registerCreateCommand } = await import('../../src/commands/workspace/create.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', ui: createUi({ argv: ['--no-color'] }) }

beforeEach(() => {
  vi.mocked(listWorkspaces).mockReset().mockResolvedValue([])
  vi.mocked(createWorkspace)
    .mockReset()
    .mockResolvedValue({ name: 'demo', dir: '/ws/demo', manifest: { name: 'demo', createdAt: '', worktrees: [] } })
  vi.mocked(registerWorkspace).mockReset().mockResolvedValue(undefined)
})

describe('runCreate', () => {
  it('creates and registers a workspace, defaulting dir to ./<name>', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/home/user')

    const handle = await runCreate(ctx, 'demo', {})

    expect(createWorkspace).toHaveBeenCalledWith({ reposRoot: '/repos' }, { name: 'demo', dir: '/home/user/demo' })
    expect(registerWorkspace).toHaveBeenCalledWith('/registry.json', { name: 'demo', dir: '/home/user/demo' })
    expect(handle.name).toBe('demo')
    cwd.mockRestore()
  })

  it('honors an explicit --dir', async () => {
    await runCreate(ctx, 'demo', { dir: '/custom/path' })

    expect(createWorkspace).toHaveBeenCalledWith({ reposRoot: '/repos' }, { name: 'demo', dir: '/custom/path' })
  })

  it('refuses to create a workspace whose name is already registered', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])

    await expect(runCreate(ctx, 'demo', {})).rejects.toThrow(SporkError)
    expect(createWorkspace).not.toHaveBeenCalled()
  })
})

describe('registerCreateCommand', () => {
  it('wires the create command and prints a confirmation', async () => {
    const program = new Command()
    registerCreateCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'create', 'demo', '--dir', '/custom'])

    expect(createWorkspace).toHaveBeenCalledWith({ reposRoot: '/repos' }, { name: 'demo', dir: '/custom' })
    expect(logSpy.mock.calls.flat().join('\n')).toContain('Created workspace "demo"')
    logSpy.mockRestore()
  })
})
