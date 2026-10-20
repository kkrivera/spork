import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FunctionTask, TaskResult } from '@spork/task-runner'

vi.mock('@spork/core', () => ({
  findGitRepoDirs: vi.fn(),
  adoptLocalRepo: vi.fn(),
  findEnclosingWorkspaceDir: vi.fn(),
  localRepoRegistryPath: (workspaceDir: string) => `${workspaceDir}/spork.repos.json`,
  SporkError: class SporkError extends Error {},
}))
vi.mock('@spork/task-runner', () => ({
  runTasks: vi.fn(),
}))

const { findGitRepoDirs, adoptLocalRepo, findEnclosingWorkspaceDir } = await import('@spork/core')
const { runTasks } = await import('@spork/task-runner')
const { runScan, registerScanCommand } = await import('../../src/commands/repo/scan.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/workspaces.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }), env: {} }
const WIDGETS_SOURCE = 'git@github.com:acme/widgets.git'

/** Drives every FunctionTask to completion the way the real runFunctionTask would, for a test's purposes. */
async function fakeRunTasks(tasks: readonly FunctionTask[]): Promise<TaskResult[]> {
  const results: TaskResult[] = []
  for (const task of tasks) {
    const output: string[] = []
    try {
      await task.run({ log: (line) => output.push(line) }, new AbortController().signal)
      results.push({ name: task.name, exitCode: null, signal: null, durationMs: 1, output, cancelled: false })
    } catch (error) {
      output.push(error instanceof Error ? error.message : String(error))
      results.push({ name: task.name, exitCode: null, signal: null, durationMs: 1, output, cancelled: false })
    }
  }
  return results
}

beforeEach(() => {
  vi.mocked(findGitRepoDirs).mockReset().mockResolvedValue(['/home/user/code/widgets'])
  vi.mocked(adoptLocalRepo)
    .mockReset()
    .mockResolvedValue({ alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' })
  vi.mocked(runTasks)
    .mockReset()
    .mockImplementation((tasks) => fakeRunTasks(tasks as FunctionTask[]))
  vi.mocked(findEnclosingWorkspaceDir).mockReset().mockReturnValue(null)
})

describe('runScan', () => {
  it('scans globally (outside any workspace) by default', async () => {
    const result = await runScan(ctx, '/home/user/code', {})

    expect(findGitRepoDirs).toHaveBeenCalledWith('/home/user/code')
    expect(adoptLocalRepo).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/home/user/code/widgets')
    expect(result.scopeLabel).toBe('global')
    expect(result.result.added).toHaveLength(1)
  })

  it('scans locally by default when inside a workspace', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')

    const result = await runScan(ctx, '/home/user/code', {})

    expect(adoptLocalRepo).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/ws/demo/spork.repos.json' },
      '/home/user/code/widgets',
    )
    expect(result.scopeLabel).toBe('local to "demo"')
  })

  it('--global overrides being inside a workspace', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')

    const result = await runScan(ctx, '/home/user/code', { global: true })

    expect(adoptLocalRepo).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/home/user/code/widgets')
    expect(result.scopeLabel).toBe('global')
  })

  it('defaults directory to the current working directory when omitted', async () => {
    await runScan(ctx)

    expect(findGitRepoDirs).toHaveBeenCalledWith(process.cwd())
  })

  it("logs each repo's own progress line into its own task pane before adopting it", async () => {
    const logSpy = vi.fn()
    vi.mocked(runTasks).mockImplementationOnce(async (tasks) => {
      const [task] = tasks as FunctionTask[]
      await task?.run({ log: logSpy }, new AbortController().signal)
      return [{ name: task?.name ?? '', exitCode: null, signal: null, durationMs: 1, output: [], cancelled: false }]
    })

    await runScan(ctx, '/home/user/code', {})

    expect(logSpy).toHaveBeenCalledWith('adopting /home/user/code/widgets...')
  })

  it('reports a failed adopt as skipped, with its error as the reason', async () => {
    vi.mocked(findGitRepoDirs).mockResolvedValue(['/home/user/code/broken'])
    vi.mocked(adoptLocalRepo).mockRejectedValue(new Error('clone failed'))

    const result = await runScan(ctx, '/home/user/code', {})

    expect(result.result.added).toEqual([])
    expect(result.result.skipped).toEqual([{ path: '/home/user/code/broken', reason: 'clone failed' }])
  })
})

describe('registerScanCommand', () => {
  it('prints added and skipped repos plus a summary line', async () => {
    vi.mocked(findGitRepoDirs).mockResolvedValue(['/home/user/code/widgets', '/home/user/code/broken'])
    vi.mocked(adoptLocalRepo).mockImplementation(async (_ctx, dir: string) => {
      if (dir.includes('broken')) throw new Error('clone failed')
      return { alias: 'widgets', source: WIDGETS_SOURCE, addedAt: '' }
    })
    const program = new Command()
    registerScanCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'scan', '/home/user/code'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain(`"widgets" -> ${WIDGETS_SOURCE} (global)`)
    expect(output).toContain('Skipped /home/user/code/broken: clone failed')
    expect(output).toContain('1 added, 1 skipped.')
    logSpy.mockRestore()
  })

  it('scans the current working directory when no directory is given', async () => {
    const program = new Command()
    registerScanCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'scan'])

    expect(findGitRepoDirs).toHaveBeenCalledWith(process.cwd())
    logSpy.mockRestore()
  })
})
