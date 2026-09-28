import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  addRepo: vi.fn(),
  resolveWorkspaceDir: vi.fn(),
}))

const { addRepo, resolveWorkspaceDir } = await import('@spork/core')
const { runAddRepo, printAddRepoResult, registerAddRepoCommand } = await import('../../src/commands/workspace/addRepo.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

beforeEach(() => {
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(addRepo)
    .mockReset()
    .mockResolvedValue({
      entry: {
        folder: 'widgets',
        source: 'git@github.com:acme/widgets.git',
        requestedRef: 'HEAD',
        localBranch: 'spork/demo/widgets',
        addedAt: '',
      },
      aliasScope: 'local', submodulesInitialized: false,
    })
})

describe('runAddRepo', () => {
  it('resolves the workspace and forwards branch/as options', async () => {
    await runAddRepo(ctx, 'demo', 'git@github.com:acme/widgets.git', { branch: 'main', as: 'w' })

    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(addRepo).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/repos.json' },
      '/ws/demo',
      { source: 'git@github.com:acme/widgets.git', ref: 'main', folder: 'w', global: undefined },
    )
  })

  it('forwards --global', async () => {
    await runAddRepo(ctx, 'demo', 'git@github.com:acme/widgets.git', { global: true })

    expect(addRepo).toHaveBeenCalledWith(
      expect.anything(),
      '/ws/demo',
      expect.objectContaining({ global: true }),
    )
  })
})

describe('printAddRepoResult', () => {
  it('is reused directly by callers other than the add-repo command (e.g. create --repo)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printAddRepoResult(ctx, 'demo', {
      entry: {
        folder: 'widgets',
        source: 'git@github.com:acme/widgets.git',
        requestedRef: 'HEAD',
        localBranch: 'spork/demo/widgets',
        addedAt: '',
      },
      aliasScope: 'local', submodulesInitialized: false,
    })

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Added "widgets"')
    logSpy.mockRestore()
  })

  it('shows which registry the alias landed in', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printAddRepoResult(ctx, 'demo', {
      entry: {
        folder: 'widgets',
        source: 'git@github.com:acme/widgets.git',
        requestedRef: 'HEAD',
        localBranch: 'spork/demo/widgets',
        addedAt: '',
      },
      aliasScope: 'global',
      submodulesInitialized: false,
    })

    expect(logSpy.mock.calls.flat().join('\n')).toContain('(alias: global)')
    logSpy.mockRestore()
  })
})

describe('registerAddRepoCommand', () => {
  it('wires the add-repo command and prints a confirmation with alias scope', async () => {
    const program = new Command()
    registerAddRepoCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'add-repo', 'demo', 'git@github.com:acme/widgets.git'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Added "widgets"')
    expect(output).toContain('(alias: local)')
    logSpy.mockRestore()
  })
})

describe('registerAddRepoCommand — submodules', () => {
  it('prints a submodule-initialized note when submodules were set up', async () => {
    vi.mocked(addRepo).mockResolvedValue({
      entry: {
        folder: 'widgets',
        source: 'git@github.com:acme/widgets.git',
        requestedRef: 'HEAD',
        localBranch: 'spork/demo/widgets',
        addedAt: '',
      },
      aliasScope: 'local', submodulesInitialized: true,
    })
    const program = new Command()
    registerAddRepoCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'add-repo', 'demo', 'git@github.com:acme/widgets.git'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Initialized submodules')
    logSpy.mockRestore()
  })

  it('prints a warning when submodule init failed', async () => {
    vi.mocked(addRepo).mockResolvedValue({
      entry: {
        folder: 'widgets',
        source: 'git@github.com:acme/widgets.git',
        requestedRef: 'HEAD',
        localBranch: 'spork/demo/widgets',
        addedAt: '',
      },
      aliasScope: 'local', submodulesInitialized: false,
      submoduleWarning: 'could not read Username',
    })
    const program = new Command()
    registerAddRepoCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'add-repo', 'demo', 'git@github.com:acme/widgets.git'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Warning')
    expect(output).toContain('could not read Username')
    logSpy.mockRestore()
  })
})
