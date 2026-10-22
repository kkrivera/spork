import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FunctionTask, TaskResult } from '@spork/task-runner'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}))
vi.mock('@spork/core', () => ({
  findGitRepoDirs: vi.fn(),
  initAndRegisterWorkspace: vi.fn(),
  adoptRepoIntoWorkspace: vi.fn(),
  manifestPath: (dir: string) => `${dir}/spork.workspace.json`,
  SporkError: class SporkError extends Error {},
}))
vi.mock('@spork/task-runner', () => ({
  runTasks: vi.fn(),
}))
vi.mock('@spork/prompts', () => ({
  select: vi.fn(),
  NotInteractiveError: class NotInteractiveError extends Error {},
}))

const { existsSync } = await import('node:fs')
const { findGitRepoDirs, initAndRegisterWorkspace, adoptRepoIntoWorkspace, SporkError } = await import('@spork/core')
const { runTasks } = await import('@spork/task-runner')
const { select, NotInteractiveError } = await import('@spork/prompts')
const { runInit, registerInitCommand } = await import('../../src/commands/workspace/init.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }), env: {} }

function fakeAdoptedEntry(folder: string) {
  return { kind: 'adopted' as const, folder, source: `/home/user/demo/${folder}`, addedAt: '' }
}

/** Drives every FunctionTask runConcurrently builds, the way the real runFunctionTask would. */
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
  vi.spyOn(process, 'cwd').mockReturnValue('/home/user/demo')
  vi.mocked(existsSync).mockReset().mockReturnValue(false)
  vi.mocked(findGitRepoDirs).mockReset().mockResolvedValue([])
  vi.mocked(initAndRegisterWorkspace)
    .mockReset()
    .mockResolvedValue({
      name: 'demo',
      dir: '/home/user/demo',
      manifest: { name: 'demo', createdAt: '', origin: 'initialized', worktrees: [] },
    })
  vi.mocked(adoptRepoIntoWorkspace).mockReset()
  vi.mocked(select).mockReset()
  vi.mocked(runTasks)
    .mockReset()
    .mockImplementation((tasks) => fakeRunTasks(tasks as FunctionTask[]))
})

describe('runInit — guards', () => {
  it('refuses when cwd is already a spork workspace, before scanning anything', async () => {
    vi.mocked(existsSync).mockReturnValue(true)

    await expect(runInit(ctx, 'demo')).rejects.toThrow(SporkError)
    expect(findGitRepoDirs).not.toHaveBeenCalled()
  })

  it('refuses when no git folders are found, without attempting a prompt', async () => {
    vi.mocked(findGitRepoDirs).mockResolvedValue([])

    await expect(runInit(ctx, 'demo')).rejects.toThrow(SporkError)
    expect(select).not.toHaveBeenCalled()
    expect(initAndRegisterWorkspace).not.toHaveBeenCalled()
  })
})

describe('runInit', () => {
  it('inits the workspace at cwd and adopts every selected folder', async () => {
    vi.mocked(findGitRepoDirs).mockResolvedValue(['/home/user/demo/widgets', '/home/user/demo/gadgets'])
    vi.mocked(select).mockResolvedValue(['widgets'])
    vi.mocked(adoptRepoIntoWorkspace).mockResolvedValue(fakeAdoptedEntry('widgets'))

    const result = await runInit(ctx, 'demo')

    expect(initAndRegisterWorkspace).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/repos.json' },
      '/registry.json',
      { name: 'demo', dir: '/home/user/demo' },
    )
    expect(adoptRepoIntoWorkspace).toHaveBeenCalledWith(expect.anything(), '/home/user/demo', 'widgets')
    expect(result.outcomes).toEqual([{ folder: 'widgets', result: fakeAdoptedEntry('widgets') }])
  })

  it('passes --no-agent-files through as agentInstructions: false', async () => {
    vi.mocked(findGitRepoDirs).mockResolvedValue(['/home/user/demo/widgets'])
    vi.mocked(select).mockResolvedValue(['widgets'])
    vi.mocked(adoptRepoIntoWorkspace).mockResolvedValue(fakeAdoptedEntry('widgets'))

    await runInit(ctx, 'demo', { agentFiles: false })

    expect(initAndRegisterWorkspace).toHaveBeenCalledWith(expect.anything(), '/registry.json', {
      name: 'demo',
      dir: '/home/user/demo',
      agentInstructions: false,
    })
  })

  it('offers a multi-select requiring at least one folder', async () => {
    vi.mocked(findGitRepoDirs).mockResolvedValue(['/home/user/demo/widgets'])
    vi.mocked(select).mockResolvedValue(['widgets'])
    vi.mocked(adoptRepoIntoWorkspace).mockResolvedValue(fakeAdoptedEntry('widgets'))

    await runInit(ctx, 'demo')

    expect(select).toHaveBeenCalledWith(expect.objectContaining({ mode: 'multi', minSelected: 1 }))
  })
})

describe('runInit — picker edge cases', () => {
  it('defaults to every found folder when the terminal cannot support a prompt', async () => {
    vi.mocked(findGitRepoDirs).mockResolvedValue(['/home/user/demo/widgets', '/home/user/demo/gadgets'])
    vi.mocked(select).mockRejectedValue(new NotInteractiveError())
    vi.mocked(adoptRepoIntoWorkspace).mockImplementation(async (_ctx, _dir, folder: string) => fakeAdoptedEntry(folder))

    const result = await runInit(ctx, 'demo')

    expect(adoptRepoIntoWorkspace).toHaveBeenCalledTimes(2)
    expect(result.outcomes.map((o) => o.folder).sort()).toEqual(['gadgets', 'widgets'])
  })

  it('throws Cancelled when the user backs out of the picker', async () => {
    vi.mocked(findGitRepoDirs).mockResolvedValue(['/home/user/demo/widgets'])
    vi.mocked(select).mockResolvedValue(null)

    await expect(runInit(ctx, 'demo')).rejects.toThrow(SporkError)
    expect(initAndRegisterWorkspace).not.toHaveBeenCalled()
  })

  it('re-throws a real picker failure rather than swallowing it', async () => {
    vi.mocked(findGitRepoDirs).mockResolvedValue(['/home/user/demo/widgets'])
    vi.mocked(select).mockRejectedValue(new Error('terminal exploded'))

    await expect(runInit(ctx, 'demo')).rejects.toThrow('terminal exploded')
  })

  it('keeps adopting the rest after one folder fails, reporting both outcomes', async () => {
    vi.mocked(findGitRepoDirs).mockResolvedValue(['/home/user/demo/widgets', '/home/user/demo/broken'])
    vi.mocked(select).mockResolvedValue(['widgets', 'broken'])
    vi.mocked(adoptRepoIntoWorkspace).mockImplementation(async (_ctx, _dir, folder: string) => {
      if (folder === 'broken') throw new Error('boom')
      return fakeAdoptedEntry(folder)
    })

    const result = await runInit(ctx, 'demo')

    expect(adoptRepoIntoWorkspace).toHaveBeenCalledTimes(2)
    expect(result.outcomes.find((o) => o.folder === 'broken')?.failure).toEqual({
      folder: 'broken',
      reason: 'boom',
      cancelled: false,
    })
    expect(result.outcomes.find((o) => o.folder === 'widgets')?.result).toEqual(fakeAdoptedEntry('widgets'))
  })
})

describe('registerInitCommand', () => {
  it('wires the init command and prints a confirmation plus each adopted folder', async () => {
    vi.mocked(findGitRepoDirs).mockResolvedValue(['/home/user/demo/widgets'])
    vi.mocked(select).mockResolvedValue(['widgets'])
    vi.mocked(adoptRepoIntoWorkspace).mockResolvedValue(fakeAdoptedEntry('widgets'))
    const program = new Command()
    registerInitCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'init', 'demo'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Initialized workspace "demo"')
    expect(output).toContain('Adopted "widgets"')
    logSpy.mockRestore()
  })

  it('prints every outcome then throws when a folder fails to adopt, so the process exits non-zero', async () => {
    vi.mocked(findGitRepoDirs).mockResolvedValue(['/home/user/demo/widgets', '/home/user/demo/broken'])
    vi.mocked(select).mockResolvedValue(['widgets', 'broken'])
    vi.mocked(adoptRepoIntoWorkspace).mockImplementation(async (_ctx, _dir, folder: string) => {
      if (folder === 'broken') throw new Error('boom')
      return fakeAdoptedEntry(folder)
    })
    const program = new Command()
    registerInitCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const run = program.parseAsync(['node', 'test', 'init', 'demo'])
    await expect(run).rejects.toThrow(/1 of 2 folders failed to adopt/)

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Failed to adopt "broken": boom')
    expect(output).toContain('Adopted "widgets"')
    logSpy.mockRestore()
  })
})
