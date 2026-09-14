import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  addRepo: vi.fn(),
  resolveWorkspaceDir: vi.fn(),
}))

const { addRepo, resolveWorkspaceDir } = await import('@spork/core')
const { runAddRepo, registerAddRepoCommand } = await import('../../src/commands/workspace/addRepo.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', ui: createUi({ argv: ['--no-color'] }) }

beforeEach(() => {
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(addRepo)
    .mockReset()
    .mockResolvedValue({
      folder: 'widgets',
      source: 'git@github.com:acme/widgets.git',
      requestedRef: 'HEAD',
      localBranch: 'spork/demo/widgets',
      addedAt: '',
    })
})

describe('runAddRepo', () => {
  it('resolves the workspace and forwards branch/as options', async () => {
    await runAddRepo(ctx, 'demo', 'git@github.com:acme/widgets.git', { branch: 'main', as: 'w' })

    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(addRepo).toHaveBeenCalledWith(
      { reposRoot: '/repos' },
      '/ws/demo',
      { source: 'git@github.com:acme/widgets.git', ref: 'main', folder: 'w' },
    )
  })
})

describe('registerAddRepoCommand', () => {
  it('wires the add-repo command and prints a confirmation', async () => {
    const program = new Command()
    registerAddRepoCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'add-repo', 'demo', 'git@github.com:acme/widgets.git'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Added "widgets"')
    logSpy.mockRestore()
  })
})
