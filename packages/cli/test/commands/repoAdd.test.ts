import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FunctionTask, TaskResult } from '@spork/task-runner'

vi.mock('@spork/core', () => ({
  addRepoSourceOrAlias: vi.fn(),
  defaultAlias: (source: string) => source,
  findEnclosingWorkspaceDir: vi.fn(),
  localRepoRegistryPath: (workspaceDir: string) => `${workspaceDir}/spork.repos.json`,
  SporkError: class SporkError extends Error {},
}))
vi.mock('@spork/task-runner', () => ({
  runTasks: vi.fn(),
}))

const { addRepoSourceOrAlias, findEnclosingWorkspaceDir } = await import('@spork/core')
const { runTasks } = await import('@spork/task-runner')
const { runAdd, registerAddCommand } = await import('../../src/commands/repo/add.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/workspaces.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }), env: {} }
const WIDGETS_SOURCE = 'git@github.com:acme/widgets.git'

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
  vi.mocked(addRepoSourceOrAlias)
    .mockReset()
    .mockResolvedValue({ alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' })
  vi.mocked(findEnclosingWorkspaceDir).mockReset().mockReturnValue(null)
  vi.mocked(runTasks)
    .mockReset()
    .mockImplementation((tasks) => fakeRunTasks(tasks as FunctionTask[]))
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

  it('re-throws the real error when the add fails, rather than swallowing it', async () => {
    vi.mocked(addRepoSourceOrAlias).mockRejectedValue(new Error('clone failed'))

    await expect(runAdd(ctx, WIDGETS_SOURCE, {})).rejects.toThrow('clone failed')
  })

  it('logs a progress line into its own task pane before adding', async () => {
    const logSpy = vi.fn()
    vi.mocked(runTasks).mockImplementationOnce(async (tasks) => {
      const [task] = tasks as FunctionTask[]
      await task?.run({ log: logSpy }, new AbortController().signal)
      return [{ name: task?.name ?? '', exitCode: null, signal: null, durationMs: 1, output: [], cancelled: false }]
    })

    await runAdd(ctx, WIDGETS_SOURCE, {})

    expect(logSpy).toHaveBeenCalledWith(`cloning/fetching ${WIDGETS_SOURCE}...`)
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
