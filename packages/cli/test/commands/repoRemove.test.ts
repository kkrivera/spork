import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FunctionTask, TaskResult } from '@spork/task-runner'

vi.mock('@spork/core', () => ({
  removeRepoSource: vi.fn(),
  removeRepo: vi.fn(),
  findRepoUsages: vi.fn(),
  listRepoAliases: vi.fn(),
  SporkError: class SporkError extends Error {},
}))
vi.mock('@spork/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  NotInteractiveError: class NotInteractiveError extends Error {},
}))
vi.mock('@spork/task-runner', () => ({
  runTasks: vi.fn(),
}))

const { removeRepoSource, removeRepo, findRepoUsages, listRepoAliases, SporkError } = await import('@spork/core')
const { select, confirm, NotInteractiveError } = await import('@spork/prompts')
const { runTasks } = await import('@spork/task-runner')
const { runRemove, registerRemoveCommand } = await import('../../src/commands/repo/remove.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/workspaces.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }), env: {} }

/** Drives every FunctionTask runConcurrently builds, the way the real runFunctionTask would — concurrently, same as production. */
async function fakeRunTasks(tasks: readonly FunctionTask[]): Promise<TaskResult[]> {
  return Promise.all(
    tasks.map(async (task) => {
      const output: string[] = []
      try {
        await task.run({ log: (line) => output.push(line) }, new AbortController().signal)
      } catch (error) {
        output.push(error instanceof Error ? error.message : String(error))
      }
      return { name: task.name, exitCode: null, signal: null, durationMs: 1, output, cancelled: false }
    }),
  )
}

beforeEach(() => {
  vi.mocked(removeRepoSource).mockReset().mockResolvedValue(undefined)
  vi.mocked(removeRepo).mockReset().mockResolvedValue(undefined)
  vi.mocked(findRepoUsages).mockReset().mockResolvedValue([])
  vi.mocked(listRepoAliases).mockReset().mockResolvedValue([
    { alias: 'widgets', source: 'git@github.com:acme/widgets.git', addedAt: '' },
    { alias: 'gadgets', source: 'git@github.com:acme/gadgets.git', addedAt: '' },
  ])
  vi.mocked(select).mockReset()
  vi.mocked(confirm).mockReset().mockResolvedValue(true)
  vi.mocked(runTasks)
    .mockReset()
    .mockImplementation((tasks) => fakeRunTasks(tasks as FunctionTask[]))
})

describe('runRemove', () => {
  it('removes the named global alias', async () => {
    const { outcomes } = await runRemove(ctx, ['widgets'], {})

    expect(removeRepoSource).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/repos.json', workspaceRegistryPath: '/workspaces.json' },
      'widgets',
    )
    expect(outcomes).toEqual([{ alias: 'widgets', removed: true, reason: undefined }])
  })

  it('removes every alias given, concurrently', async () => {
    const { outcomes } = await runRemove(ctx, ['widgets', 'gadgets'], {})

    expect(removeRepoSource).toHaveBeenCalledTimes(2)
    expect(outcomes).toEqual([
      { alias: 'widgets', removed: true, reason: undefined },
      { alias: 'gadgets', removed: true, reason: undefined },
    ])
  })

  it('reports one failure without losing the others (best-effort, not fail-fast)', async () => {
    vi.mocked(removeRepoSource).mockImplementation((_ctx, alias) =>
      alias === 'widgets' ? Promise.reject(new Error('still in use')) : Promise.resolve(undefined),
    )

    const { outcomes } = await runRemove(ctx, ['widgets', 'gadgets'], {})

    expect(outcomes).toEqual([
      { alias: 'widgets', removed: false, reason: 'still in use' },
      { alias: 'gadgets', removed: true, reason: undefined },
    ])
  })

  it('reports a specific error, without attempting removal, for an alias that is not registered globally', async () => {
    const { outcomes } = await runRemove(ctx, ['not-global'], {})

    expect(removeRepoSource).not.toHaveBeenCalled()
    expect(outcomes).toEqual([
      {
        alias: 'not-global',
        removed: false,
        reason: expect.stringContaining('spork workspace remove-repo'),
      },
    ])
  })
})

describe('runRemove — picking aliases from a list', () => {
  it('offers a multi-select of every globally registered alias when none are given', async () => {
    vi.mocked(select).mockResolvedValue(['widgets', 'gadgets'])

    const { outcomes } = await runRemove(ctx, [], {})

    expect(listRepoAliases).toHaveBeenCalledWith('/repos.json', '/repos')
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ mode: 'multi' }))
    expect(outcomes.map((o) => o.alias)).toEqual(['widgets', 'gadgets'])
  })

  it('refuses when nothing is registered globally', async () => {
    vi.mocked(listRepoAliases).mockResolvedValue([])

    await expect(runRemove(ctx, [], {})).rejects.toThrow(SporkError)
    expect(select).not.toHaveBeenCalled()
  })

  it('demands explicit aliases when there is no interactive terminal', async () => {
    vi.mocked(select).mockRejectedValue(new NotInteractiveError())

    const error: unknown = await runRemove(ctx, [], {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SporkError)
    expect((error as Error).message).toContain('spork repo remove <alias...>')
  })

  it('throws Cancelled when the user backs out of the picker', async () => {
    vi.mocked(select).mockResolvedValue(null)

    await expect(runRemove(ctx, [], {})).rejects.toThrow(SporkError)
  })

  it('re-throws a real picker failure rather than swallowing it', async () => {
    vi.mocked(select).mockRejectedValue(new Error('terminal exploded'))

    await expect(runRemove(ctx, [], {})).rejects.toThrow('terminal exploded')
  })
})

describe('runRemove — cascading real worktree usages', () => {
  it('removes the usage\'s worktree first, then the alias/cache, without prompting when nothing is in use', async () => {
    const { outcomes } = await runRemove(ctx, ['widgets'], {})

    expect(findRepoUsages).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/repos.json', workspaceRegistryPath: '/workspaces.json' },
      'git@github.com:acme/widgets.git',
    )
    expect(confirm).not.toHaveBeenCalled()
    expect(removeRepo).not.toHaveBeenCalled()
    expect(outcomes).toEqual([{ alias: 'widgets', removed: true, reason: undefined }])
  })

  it('warns and lists the affected workspaces/folders before cascading', async () => {
    vi.mocked(findRepoUsages).mockImplementation(async (_ctx, source: string) =>
      source === 'git@github.com:acme/widgets.git' ? [{ workspaceName: 'demo', workspaceDir: '/ws/demo', folder: 'api' }] : [],
    )

    await runRemove(ctx, ['widgets'], {})

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('"widgets" — "demo" (api)') }),
    )
    expect(removeRepo).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/ws/demo', 'api')
    expect(removeRepoSource).toHaveBeenCalledWith(expect.anything(), 'widgets')
  })

  it('throws Cancelled and removes nothing when the warning is declined', async () => {
    vi.mocked(findRepoUsages).mockResolvedValue([{ workspaceName: 'demo', workspaceDir: '/ws/demo', folder: 'api' }])
    vi.mocked(confirm).mockResolvedValue(false)

    await expect(runRemove(ctx, ['widgets'], {})).rejects.toThrow(SporkError)
    expect(removeRepo).not.toHaveBeenCalled()
    expect(removeRepoSource).not.toHaveBeenCalled()
  })

  it('skips the prompt when --yes is passed, still cascading', async () => {
    vi.mocked(findRepoUsages).mockResolvedValue([{ workspaceName: 'demo', workspaceDir: '/ws/demo', folder: 'api' }])

    await runRemove(ctx, ['widgets'], { yes: true })

    expect(confirm).not.toHaveBeenCalled()
    expect(removeRepo).toHaveBeenCalledWith(expect.anything(), '/ws/demo', 'api')
  })

  it('demands --yes when there is no interactive terminal and a worktree is in use', async () => {
    vi.mocked(findRepoUsages).mockResolvedValue([{ workspaceName: 'demo', workspaceDir: '/ws/demo', folder: 'api' }])
    vi.mocked(confirm).mockRejectedValue(new NotInteractiveError())

    await expect(runRemove(ctx, ['widgets'], {})).rejects.toThrow(SporkError)
    expect(removeRepo).not.toHaveBeenCalled()
  })
})

describe('registerRemoveCommand', () => {
  it('wires the remove command and prints a confirmation', async () => {
    const program = new Command()
    registerRemoveCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'remove', 'widgets'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Removed "widgets"')
    logSpy.mockRestore()
  })

  it('accepts several aliases and prints each result', async () => {
    const program = new Command()
    registerRemoveCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'remove', 'widgets', 'gadgets'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Removed "widgets"')
    expect(output).toContain('Removed "gadgets"')
    logSpy.mockRestore()
  })

  it('prints each failure and throws afterward, keeping the exit code non-zero', async () => {
    vi.mocked(removeRepoSource).mockImplementation((_ctx, alias) =>
      alias === 'widgets' ? Promise.reject(new Error('still in use')) : Promise.resolve(undefined),
    )
    const program = new Command()
    registerRemoveCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(program.parseAsync(['node', 'test', 'remove', 'widgets', 'gadgets'])).rejects.toThrow(SporkError)

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Failed to remove "widgets": still in use')
    expect(output).toContain('Removed "gadgets"')
    logSpy.mockRestore()
  })

  it('points at workspace remove-repo for an alias that is only local somewhere', async () => {
    const program = new Command()
    registerRemoveCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(program.parseAsync(['node', 'test', 'remove', 'not-global'])).rejects.toThrow(SporkError)

    expect(logSpy.mock.calls.flat().join('\n')).toContain('spork workspace remove-repo')
    logSpy.mockRestore()
  })

  it('accepts no aliases, picking from the list instead', async () => {
    vi.mocked(select).mockResolvedValue(['widgets'])
    const program = new Command()
    registerRemoveCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'remove'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Removed "widgets"')
    logSpy.mockRestore()
  })
})
