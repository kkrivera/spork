import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FunctionTask, TaskResult } from '@spork/task-runner'

vi.mock('@spork/core', () => ({
  addRepo: vi.fn(),
  defaultAlias: (source: string) => source,
  resolveWorkspaceDir: vi.fn(),
  listWorkspaces: vi.fn(),
  findEnclosingWorkspaceDir: vi.fn(),
  SporkError: class SporkError extends Error {},
}))
vi.mock('@spork/task-runner', () => ({
  runTasks: vi.fn(),
}))
vi.mock('@spork/prompts', () => ({
  select: vi.fn(),
  NotInteractiveError: class NotInteractiveError extends Error {},
}))
vi.mock('../../src/commands/repo/list.js', () => ({
  runList: vi.fn(),
}))

const { addRepo, resolveWorkspaceDir, listWorkspaces, findEnclosingWorkspaceDir, SporkError } = await import('@spork/core')
const { runTasks } = await import('@spork/task-runner')
const { select } = await import('@spork/prompts')
const { runList } = await import('../../src/commands/repo/list.js')
const { runAddRepo, runAddRepoFromRegistry, printAddRepoResult, registerAddRepoCommand } = await import(
  '../../src/commands/workspace/addRepo.js'
)
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

const widgetsEntry = {
  folder: 'widgets',
  source: 'git@github.com:acme/widgets.git',
  requestedRef: 'HEAD',
  localBranch: 'demo',
  addedAt: '',
}

/** Drives every FunctionTask runConcurrently builds, the way the real runFunctionTask would. */
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
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(addRepo)
    .mockReset()
    .mockResolvedValue({ entry: widgetsEntry, aliasScope: 'local', submodulesInitialized: false })
  vi.mocked(runTasks)
    .mockReset()
    .mockImplementation((tasks) => fakeRunTasks(tasks as FunctionTask[]))
  vi.mocked(listWorkspaces).mockReset().mockResolvedValue([])
  vi.mocked(findEnclosingWorkspaceDir).mockReset().mockReturnValue(null)
  vi.mocked(select).mockReset()
  vi.mocked(runList).mockReset().mockResolvedValue([])
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

    expect(addRepo).toHaveBeenCalledWith(expect.anything(), '/ws/demo', expect.objectContaining({ global: true }))
  })

  it('re-throws the real error when the add fails, rather than swallowing it', async () => {
    vi.mocked(addRepo).mockRejectedValue(new Error('worktree add failed'))

    await expect(runAddRepo(ctx, 'demo', 'git@github.com:acme/widgets.git', {})).rejects.toThrow('worktree add failed')
  })

  it('logs a progress line into its own task pane before adding', async () => {
    const logSpy = vi.fn()
    vi.mocked(runTasks).mockImplementationOnce(async (tasks) => {
      const [task] = tasks as FunctionTask[]
      await task?.run({ log: logSpy }, new AbortController().signal)
      return [{ name: task?.name ?? '', exitCode: null, signal: null, durationMs: 1, output: [], cancelled: false }]
    })

    await runAddRepo(ctx, 'demo', 'git@github.com:acme/widgets.git', {})

    expect(logSpy).toHaveBeenCalledWith('cloning/fetching git@github.com:acme/widgets.git...')
  })
})

describe('runAddRepo — resolving the workspace when --workspace is omitted', () => {
  it('auto-detects the enclosing workspace from cwd, without prompting', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])

    const { workspace } = await runAddRepo(ctx, undefined, 'git@github.com:acme/widgets.git', {})

    expect(select).not.toHaveBeenCalled()
    expect(workspace).toBe('demo')
  })

  it('offers a single-select when cwd is not inside a workspace', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    vi.mocked(select).mockResolvedValue(['demo'])

    const { workspace } = await runAddRepo(ctx, undefined, 'git@github.com:acme/widgets.git', {})

    expect(select).toHaveBeenCalledWith(expect.objectContaining({ mode: 'single' }))
    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(workspace).toBe('demo')
  })

  it('refuses with a clear error when nothing is registered yet', async () => {
    await expect(runAddRepo(ctx, undefined, 'git@github.com:acme/widgets.git', {})).rejects.toThrow(SporkError)
  })
})

describe('runAddRepoFromRegistry', () => {
  it('resolves the workspace, lists registered repos, and adds every one picked', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    vi.mocked(select).mockImplementation(async (config) => {
      if (config.message === 'Select a workspace') return ['demo']
      return ['git@github.com:acme/widgets.git', 'git@github.com:acme/gadgets.git']
    })
    vi.mocked(runList).mockResolvedValue([
      { alias: 'widgets', source: 'git@github.com:acme/widgets.git', scope: 'global' },
      { alias: 'gadgets', source: 'git@github.com:acme/gadgets.git', scope: 'global' },
    ])

    const { workspace, outcomes } = await runAddRepoFromRegistry(ctx, undefined, {})

    expect(workspace).toBe('demo')
    expect(outcomes).toHaveLength(2)
    expect(addRepo).toHaveBeenCalledTimes(2)
  })

  it('uses the given workspace directly without prompting for it', async () => {
    vi.mocked(select).mockResolvedValue(['git@github.com:acme/widgets.git'])
    vi.mocked(runList).mockResolvedValue([{ alias: 'widgets', source: 'git@github.com:acme/widgets.git', scope: 'global' }])

    await runAddRepoFromRegistry(ctx, 'demo', {})

    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
  })

  it('refuses with a clear error when no repos are registered yet', async () => {
    vi.mocked(runList).mockResolvedValue([])

    await expect(runAddRepoFromRegistry(ctx, 'demo', {})).rejects.toThrow(SporkError)
  })
})

describe('printAddRepoResult', () => {
  it('is reused directly by callers other than the add-repo command (e.g. create --repo)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printAddRepoResult(ctx, 'demo', { entry: widgetsEntry, aliasScope: 'local', submodulesInitialized: false })

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Added "widgets"')
    logSpy.mockRestore()
  })

  it('shows which registry the alias landed in', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printAddRepoResult(ctx, 'demo', { entry: widgetsEntry, aliasScope: 'global', submodulesInitialized: false })

    expect(logSpy.mock.calls.flat().join('\n')).toContain('(alias: global)')
    logSpy.mockRestore()
  })
})

describe('printAddRepoResult — branch reuse', () => {
  it('notes when an existing branch was reused instead of creating a fresh one', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printAddRepoResult(ctx, 'demo', { entry: widgetsEntry, aliasScope: 'local', submodulesInitialized: false, reusedExistingBranch: true })

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Reused existing branch "demo"')
    logSpy.mockRestore()
  })

  it('says nothing about reuse when a fresh branch was created', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printAddRepoResult(ctx, 'demo', { entry: widgetsEntry, aliasScope: 'local', submodulesInitialized: false, reusedExistingBranch: false })

    expect(logSpy.mock.calls.flat().join('\n')).not.toContain('Reused')
    logSpy.mockRestore()
  })
})

describe('registerAddRepoCommand', () => {
  it('wires the add-repo command and prints a confirmation with alias scope', async () => {
    const program = new Command()
    registerAddRepoCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'add-repo', '--workspace', 'demo', 'git@github.com:acme/widgets.git'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Added "widgets"')
    expect(output).toContain('(alias: local)')
    logSpy.mockRestore()
  })

  it('accepts a source with no --workspace, auto-detecting/picking it', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    const program = new Command()
    registerAddRepoCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'add-repo', 'git@github.com:acme/widgets.git'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Added "widgets"')
    logSpy.mockRestore()
  })
})

describe('registerAddRepoCommand — no source given', () => {
  it('lists registered repos as a multi-select and adds every one chosen', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    vi.mocked(runList).mockResolvedValue([{ alias: 'widgets', source: 'git@github.com:acme/widgets.git', scope: 'global' }])
    vi.mocked(select).mockResolvedValue(['git@github.com:acme/widgets.git'])
    const program = new Command()
    registerAddRepoCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'add-repo'])

    expect(select).toHaveBeenCalledWith(expect.objectContaining({ mode: 'multi' }))
    expect(logSpy.mock.calls.flat().join('\n')).toContain('Added "widgets"')
    logSpy.mockRestore()
  })

  it('rejects --branch/--as with no explicit source', async () => {
    const program = new Command()
    registerAddRepoCommand(program, ctx)

    await expect(program.parseAsync(['node', 'test', 'add-repo', '--branch', 'main'])).rejects.toThrow(SporkError)
    await expect(program.parseAsync(['node', 'test', 'add-repo', '--as', 'w'])).rejects.toThrow(SporkError)
  })

  it('prints each failure and throws afterward, keeping the exit code non-zero', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    vi.mocked(runList).mockResolvedValue([
      { alias: 'widgets', source: 'git@github.com:acme/widgets.git', scope: 'global' },
      { alias: 'gadgets', source: 'git@github.com:acme/gadgets.git', scope: 'global' },
    ])
    vi.mocked(select).mockResolvedValue(['git@github.com:acme/widgets.git', 'git@github.com:acme/gadgets.git'])
    vi.mocked(addRepo).mockImplementation((_ctx, _dir, opts) =>
      opts.source.includes('gadgets') ? Promise.reject(new Error('clone failed')) : Promise.resolve({ entry: widgetsEntry, aliasScope: 'local', submodulesInitialized: false }),
    )
    const program = new Command()
    registerAddRepoCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(program.parseAsync(['node', 'test', 'add-repo'])).rejects.toThrow(SporkError)

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Added "widgets"')
    expect(output).toContain('Failed to add "git@github.com:acme/gadgets.git": clone failed')
    logSpy.mockRestore()
  })
})

describe('registerAddRepoCommand — submodules', () => {
  it('prints a submodule-initialized note when submodules were set up', async () => {
    vi.mocked(addRepo).mockResolvedValue({ entry: widgetsEntry, aliasScope: 'local', submodulesInitialized: true })
    const program = new Command()
    registerAddRepoCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'add-repo', '--workspace', 'demo', 'git@github.com:acme/widgets.git'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Initialized submodules')
    logSpy.mockRestore()
  })

  it('prints a warning when submodule init failed', async () => {
    vi.mocked(addRepo).mockResolvedValue({
      entry: widgetsEntry,
      aliasScope: 'local',
      submodulesInitialized: false,
      submoduleWarning: 'could not read Username',
    })
    const program = new Command()
    registerAddRepoCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'add-repo', '--workspace', 'demo', 'git@github.com:acme/widgets.git'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Warning')
    expect(output).toContain('could not read Username')
    logSpy.mockRestore()
  })
})
