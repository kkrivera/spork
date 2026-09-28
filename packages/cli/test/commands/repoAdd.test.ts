import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  addRepoSourceOrAlias: vi.fn(),
  findEnclosingWorkspaceDir: vi.fn(),
  localRepoRegistryPath: (workspaceDir: string) => `${workspaceDir}/spork.repos.json`,
  SporkError: class SporkError extends Error {},
}))

const { addRepoSourceOrAlias, findEnclosingWorkspaceDir } = await import('@spork/core')
const { runAdd, registerAddCommand } = await import('../../src/commands/repo/add.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/workspaces.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }
const WIDGETS_SOURCE = 'git@github.com:acme/widgets.git'

beforeEach(() => {
  vi.mocked(addRepoSourceOrAlias)
    .mockReset()
    .mockResolvedValue({ alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' })
  vi.mocked(findEnclosingWorkspaceDir).mockReset().mockReturnValue(null)
})

describe('runAdd', () => {
  it('registers globally (outside any workspace) and forwards --as', async () => {
    const result = await runAdd(ctx, WIDGETS_SOURCE, { as: 'w' })

    expect(addRepoSourceOrAlias).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/repos.json' },
      WIDGETS_SOURCE,
      { alias: 'w' },
    )
    expect(result.scopeLabel).toBe('global')
  })

  it('registers locally by default when inside a workspace', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')

    const result = await runAdd(ctx, WIDGETS_SOURCE, {})

    expect(addRepoSourceOrAlias).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/ws/demo/spork.repos.json' },
      WIDGETS_SOURCE,
      { alias: undefined },
    )
    expect(result.scopeLabel).toBe('local to "demo"')
  })

  it('--global overrides being inside a workspace', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')

    const result = await runAdd(ctx, WIDGETS_SOURCE, { global: true })

    expect(addRepoSourceOrAlias).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/repos.json' },
      WIDGETS_SOURCE,
      { alias: undefined },
    )
    expect(result.scopeLabel).toBe('global')
  })
})

describe('registerAddCommand', () => {
  it('wires the add command and prints the resulting alias with its scope', async () => {
    const program = new Command()
    registerAddCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'add', WIDGETS_SOURCE])

    expect(logSpy.mock.calls.flat().join('\n')).toContain(`"widgets" -> ${WIDGETS_SOURCE} (global)`)
    logSpy.mockRestore()
  })
})
