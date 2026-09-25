import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  addRepoSourceOrAlias: vi.fn(),
}))

const { addRepoSourceOrAlias } = await import('@spork/core')
const { runAdd, registerAddCommand } = await import('../../src/commands/repo/add.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/workspaces.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }
const WIDGETS_SOURCE = 'git@github.com:acme/widgets.git'

beforeEach(() => {
  vi.mocked(addRepoSourceOrAlias)
    .mockReset()
    .mockResolvedValue({ alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' })
})

describe('runAdd', () => {
  it('forwards the source and --as alias to addRepoSourceOrAlias', async () => {
    await runAdd(ctx, WIDGETS_SOURCE, { as: 'w' })

    expect(addRepoSourceOrAlias).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/repos.json' },
      WIDGETS_SOURCE,
      { alias: 'w' },
    )
  })
})

describe('registerAddCommand', () => {
  it('wires the add command and prints the resulting alias', async () => {
    const program = new Command()
    registerAddCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'add', WIDGETS_SOURCE])

    expect(logSpy.mock.calls.flat().join('\n')).toContain(`"widgets" -> ${WIDGETS_SOURCE}`)
    logSpy.mockRestore()
  })
})
