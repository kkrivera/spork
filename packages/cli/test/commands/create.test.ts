import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  createWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  registerWorkspace: vi.fn(),
  addRepo: vi.fn(),
  resolveWorkspaceDir: vi.fn(),
  SporkError: class SporkError extends Error {},
}))

const { createWorkspace, listWorkspaces, registerWorkspace, addRepo, resolveWorkspaceDir, SporkError } =
  await import('@spork/core')
const { runCreate, runCreateWithRepos, registerCreateCommand } = await import('../../src/commands/workspace/create.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

function fakeEntry(folder: string) {
  return { folder, source: `git@github.com:acme/${folder}.git`, requestedRef: 'HEAD', localBranch: `spork/demo/${folder}`, addedAt: '' }
}

beforeEach(() => {
  vi.mocked(listWorkspaces).mockReset().mockResolvedValue([])
  vi.mocked(createWorkspace)
    .mockReset()
    .mockResolvedValue({ name: 'demo', dir: '/ws/demo', manifest: { name: 'demo', createdAt: '', worktrees: [] } })
  vi.mocked(registerWorkspace).mockReset().mockResolvedValue(undefined)
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(addRepo).mockReset()
})

describe('runCreate', () => {
  it('creates and registers a workspace, defaulting dir to ./<name>', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/home/user')

    const handle = await runCreate(ctx, 'demo', {})

    expect(createWorkspace).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, { name: 'demo', dir: '/home/user/demo' })
    expect(registerWorkspace).toHaveBeenCalledWith('/registry.json', { name: 'demo', dir: '/home/user/demo' })
    expect(handle.name).toBe('demo')
    cwd.mockRestore()
  })

  it('honors an explicit --dir', async () => {
    await runCreate(ctx, 'demo', { dir: '/custom/path' })

    expect(createWorkspace).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, { name: 'demo', dir: '/custom/path' })
  })

  it('refuses to create a workspace whose name is already registered', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])

    await expect(runCreate(ctx, 'demo', {})).rejects.toThrow(SporkError)
    expect(createWorkspace).not.toHaveBeenCalled()
  })
})

describe('runCreateWithRepos', () => {
  it('creates the workspace and adds no repos when --repo was not given', async () => {
    const result = await runCreateWithRepos(ctx, 'demo', {})

    expect(result.handle.name).toBe('demo')
    expect(result.addRepoResults).toEqual([])
    expect(addRepo).not.toHaveBeenCalled()
  })

  it('adds each --repo in order via the same addRepo the standalone command uses', async () => {
    vi.mocked(addRepo)
      .mockResolvedValueOnce({ entry: fakeEntry('widgets'), aliasScope: 'local', submodulesInitialized: false })
      .mockResolvedValueOnce({ entry: fakeEntry('gadgets'), aliasScope: 'local', submodulesInitialized: false })

    const result = await runCreateWithRepos(ctx, 'demo', { repo: ['widgets-source', 'gadgets-source'] })

    expect(result.addRepoResults.map((r) => r.entry.folder)).toEqual(['widgets', 'gadgets'])
    expect(addRepo).toHaveBeenNthCalledWith(1, expect.anything(), '/ws/demo', expect.objectContaining({ source: 'widgets-source' }))
    expect(addRepo).toHaveBeenNthCalledWith(2, expect.anything(), '/ws/demo', expect.objectContaining({ source: 'gadgets-source' }))
  })

  it('is fail-fast: stops at the first failing repo, leaving the workspace already created', async () => {
    vi.mocked(addRepo).mockRejectedValueOnce(new SporkError('boom'))

    await expect(runCreateWithRepos(ctx, 'demo', { repo: ['bad-source', 'never-reached'] })).rejects.toThrow('boom')
    expect(addRepo).toHaveBeenCalledTimes(1)
    expect(createWorkspace).toHaveBeenCalled()
  })

  it('forwards --global to every repo added', async () => {
    vi.mocked(addRepo).mockResolvedValue({ entry: fakeEntry('widgets'), aliasScope: 'global', submodulesInitialized: false })

    await runCreateWithRepos(ctx, 'demo', { repo: ['widgets-source'], global: true })

    expect(addRepo).toHaveBeenCalledWith(expect.anything(), '/ws/demo', expect.objectContaining({ global: true }))
  })
})

describe('registerCreateCommand', () => {
  it('wires the create command and prints a confirmation', async () => {
    const program = new Command()
    registerCreateCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'create', 'demo', '--dir', '/custom'])

    expect(createWorkspace).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, { name: 'demo', dir: '/custom' })
    expect(logSpy.mock.calls.flat().join('\n')).toContain('Created workspace "demo"')
    logSpy.mockRestore()
  })

  it('accepts repeated --repo flags and prints each result', async () => {
    vi.mocked(addRepo)
      .mockResolvedValueOnce({ entry: fakeEntry('widgets'), aliasScope: 'local', submodulesInitialized: false })
      .mockResolvedValueOnce({ entry: fakeEntry('gadgets'), aliasScope: 'local', submodulesInitialized: true })
    const program = new Command()
    registerCreateCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'create', 'demo', '--repo', 'widgets-source', '--repo', 'gadgets-source'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('"widgets"')
    expect(output).toContain('"gadgets"')
    expect(output).toContain('Initialized submodules in "gadgets"')
    expect(output).not.toContain('Add a repo with')
    logSpy.mockRestore()
  })
})
