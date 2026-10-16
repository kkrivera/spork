import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FunctionTask, TaskResult } from '@spork/task-runner'

vi.mock('@spork/core', () => ({
  addRepo: vi.fn(),
  defaultAlias: (source: string) => source,
  resolveWorkspaceDir: vi.fn(),
  SporkError: class SporkError extends Error {},
}))
vi.mock('@spork/task-runner', () => ({
  runTasks: vi.fn(),
}))

const { addRepo, resolveWorkspaceDir } = await import('@spork/core')
const { runTasks } = await import('@spork/task-runner')
const { runAddRepo, printAddRepoResult, registerAddRepoCommand } = await import('../../src/commands/workspace/addRepo.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

/** Drives the single FunctionTask runConcurrently builds, the way the real runFunctionTask would. */
async function fakeRunTasks(tasks: readonly FunctionTask[]): Promise<TaskResult[]> {
  const results: TaskResult[] = []
  for (const task of tasks) {
    const output: string[] = []
    try {
      await task.run({ log: (line) => output.push(line) }, new AbortController().signal)
    } catch (error) {
      output.push(error instanceof Error ? error.message : String(error))
    }
    results.push({ name: task.name, exitCode: null, signal: null, durationMs: 1, output, cancelled: false })
  }
  return results
}

beforeEach(() => {
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(addRepo)
    .mockReset()
    .mockResolvedValue({
      entry: {
        folder: 'widgets',
        source: 'git@github.com:acme/widgets.git',
        requestedRef: 'HEAD',
        localBranch: 'demo',
        addedAt: '',
      },
      aliasScope: 'local', submodulesInitialized: false,
    })
  vi.mocked(runTasks)
    .mockReset()
    .mockImplementation((tasks) => fakeRunTasks(tasks as FunctionTask[]))
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

describe('printAddRepoResult', () => {
  it('is reused directly by callers other than the add-repo command (e.g. create --repo)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printAddRepoResult(ctx, 'demo', {
      entry: {
        folder: 'widgets',
        source: 'git@github.com:acme/widgets.git',
        requestedRef: 'HEAD',
        localBranch: 'demo',
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
        localBranch: 'demo',
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
        localBranch: 'demo',
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
        localBranch: 'demo',
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
