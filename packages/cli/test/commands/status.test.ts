import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FunctionTask, TaskResult } from '@spork/task-runner'

vi.mock('@spork/core', () => ({
  getWorkspaceStatus: vi.fn(),
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

const { getWorkspaceStatus, resolveWorkspaceDir, listWorkspaces, findEnclosingWorkspaceDir, SporkError } = await import('@spork/core')
const { runTasks } = await import('@spork/task-runner')
const { select } = await import('@spork/prompts')
const { runStatus, registerStatusCommand } = await import('../../src/commands/workspace/status.js')
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
  vi.mocked(getWorkspaceStatus).mockReset()
  vi.mocked(listWorkspaces).mockReset().mockResolvedValue([])
  vi.mocked(findEnclosingWorkspaceDir).mockReset().mockReturnValue(null)
  vi.mocked(select).mockReset()
  vi.mocked(runTasks)
    .mockReset()
    .mockImplementation((tasks) => fakeRunTasks(tasks as FunctionTask[]))
})

describe('runStatus', () => {
  it('resolves the workspace and returns its worktree statuses', async () => {
    vi.mocked(getWorkspaceStatus).mockResolvedValue([])

    await runStatus(ctx, 'demo')

    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(getWorkspaceStatus).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/ws/demo')
  })

  it('re-throws the real error when the status read fails, rather than swallowing it', async () => {
    vi.mocked(getWorkspaceStatus).mockRejectedValue(new Error('git status failed'))

    await expect(runStatus(ctx, 'demo')).rejects.toThrow('git status failed')
  })

  it('logs a progress line into its own task pane before reading status', async () => {
    vi.mocked(getWorkspaceStatus).mockResolvedValue([])
    const logSpy = vi.fn()
    vi.mocked(runTasks).mockImplementationOnce(async (tasks) => {
      const [task] = tasks as FunctionTask[]
      await task?.run({ log: logSpy }, new AbortController().signal)
      return [{ name: task?.name ?? '', exitCode: null, signal: null, durationMs: 1, output: [], cancelled: false }]
    })

    await runStatus(ctx, 'demo')

    expect(logSpy).toHaveBeenCalledWith('reading git status...')
  })
})

describe('runStatus — picking from a list (no workspace given)', () => {
  it('offers a single-select of registered workspaces and reads the chosen one', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    vi.mocked(select).mockResolvedValue(['demo'])
    vi.mocked(getWorkspaceStatus).mockResolvedValue([])

    await runStatus(ctx, undefined)

    expect(select).toHaveBeenCalledWith(expect.objectContaining({ mode: 'single' }))
    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
  })

  it('refuses with a clear error when nothing is registered yet', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([])

    await expect(runStatus(ctx, undefined)).rejects.toThrow(SporkError)
    expect(select).not.toHaveBeenCalled()
  })

  it('auto-detects the enclosing workspace from cwd, without prompting', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    vi.mocked(getWorkspaceStatus).mockResolvedValue([])

    await runStatus(ctx, undefined)

    expect(select).not.toHaveBeenCalled()
    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
  })
})

describe('registerStatusCommand', () => {
  it('prints a table with branch and dirty state', async () => {
    vi.mocked(getWorkspaceStatus).mockResolvedValue([
      {
        folder: 'widgets',
        source: 'x',
        requestedRef: 'main',
        localBranch: 'demo',
        addedAt: '',
        status: { branch: 'demo', isClean: false, changedFiles: 3 },
      },
    ])
    const program = new Command()
    registerStatusCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'status', 'demo'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('widgets')
    expect(output).toContain('3 changed')
    logSpy.mockRestore()
  })

  it('reports a detached worktree distinctly', async () => {
    vi.mocked(getWorkspaceStatus).mockResolvedValue([
      {
        folder: 'widgets',
        source: 'x',
        requestedRef: 'main',
        localBranch: 'demo',
        addedAt: '',
        status: { branch: null, isClean: true, changedFiles: 0 },
      },
    ])
    const program = new Command()
    registerStatusCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'status', 'demo'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('(detached)')
    logSpy.mockRestore()
  })

  it('prints a helpful message for a workspace with no repos', async () => {
    vi.mocked(getWorkspaceStatus).mockResolvedValue([])
    const program = new Command()
    registerStatusCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'status', 'demo'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('no repos yet')
    logSpy.mockRestore()
  })
})
