import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FunctionTask, TaskResult } from '@spork/task-runner'

vi.mock('@spork/core', () => ({
  createWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  registerWorkspace: vi.fn(),
  addRepo: vi.fn(),
  defaultAlias: (source: string) => source,
  resolveWorkspaceDir: vi.fn(),
  findEnclosingWorkspaceDir: vi.fn(),
  listRepoAliases: vi.fn(),
  localRepoRegistryPath: (workspaceDir: string) => `${workspaceDir}/spork.repos.json`,
  SporkError: class SporkError extends Error {},
}))
vi.mock('@spork/task-runner', () => ({
  runTasks: vi.fn(),
}))
vi.mock('@spork/prompts', () => ({
  select: vi.fn(),
  NotInteractiveError: class NotInteractiveError extends Error {},
}))

const { createWorkspace, listWorkspaces, registerWorkspace, addRepo, resolveWorkspaceDir, findEnclosingWorkspaceDir, listRepoAliases, SporkError } =
  await import('@spork/core')
const { runTasks } = await import('@spork/task-runner')
const { select, NotInteractiveError } = await import('@spork/prompts')
const { runCreate, runCreateWithRepos, registerCreateCommand } = await import('../../src/commands/workspace/create.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

function fakeEntry(folder: string) {
  return { folder, source: `git@github.com:acme/${folder}.git`, requestedRef: 'HEAD', localBranch: `spork/demo/${folder}`, addedAt: '' }
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
  vi.mocked(listWorkspaces).mockReset().mockResolvedValue([])
  vi.mocked(createWorkspace)
    .mockReset()
    .mockResolvedValue({ name: 'demo', dir: '/ws/demo', manifest: { name: 'demo', createdAt: '', worktrees: [] } })
  vi.mocked(registerWorkspace).mockReset().mockResolvedValue(undefined)
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(addRepo).mockReset()
  vi.mocked(findEnclosingWorkspaceDir).mockReset().mockReturnValue(null)
  vi.mocked(listRepoAliases).mockReset().mockResolvedValue([])
  vi.mocked(select).mockReset()
  vi.mocked(runTasks)
    .mockReset()
    .mockImplementation((tasks) => fakeRunTasks(tasks as FunctionTask[]))
})

describe('runCreate', () => {
  it('creates and registers a workspace, defaulting dir to ./<name>', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/home/user')

    const handle = await runCreate(ctx, 'demo', {})

    expect(createWorkspace).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, { name: 'demo', dir: '/home/user/demo' })
    expect(registerWorkspace).toHaveBeenCalledWith('/registry.json', { name: 'demo', dir: '/home/user/demo' })
    expect(handle.name).toBe('demo')
    cwd.mockRestore()
  })

  it('honors an explicit --dir', async () => {
    await runCreate(ctx, 'demo', { dir: '/custom/path' })

    expect(createWorkspace).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, { name: 'demo', dir: '/custom/path' })
  })

  it('refuses to create a workspace whose name is already registered', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])

    await expect(runCreate(ctx, 'demo', {})).rejects.toThrow(SporkError)
    expect(createWorkspace).not.toHaveBeenCalled()
  })
})

describe('runCreateWithRepos', () => {
  it('creates the workspace and adds no repos when --repo was not given', async () => {
    const result = await runCreateWithRepos(ctx, 'demo', {})

    expect(result.handle.name).toBe('demo')
    expect(result.repoOutcomes).toEqual([])
    expect(addRepo).not.toHaveBeenCalled()
  })

  it('adds every --repo concurrently, in the given order, via the same addRepo the standalone command uses', async () => {
    vi.mocked(addRepo)
      .mockImplementationOnce(async () => fakeEntryResult('widgets'))
      .mockImplementationOnce(async () => fakeEntryResult('gadgets'))

    const result = await runCreateWithRepos(ctx, 'demo', { repo: ['widgets-source', 'gadgets-source'] })

    expect(result.repoOutcomes.map((o) => o.result?.entry.folder)).toEqual(['widgets', 'gadgets'])
    expect(addRepo).toHaveBeenCalledWith(expect.anything(), '/ws/demo', expect.objectContaining({ source: 'widgets-source' }))
    expect(addRepo).toHaveBeenCalledWith(expect.anything(), '/ws/demo', expect.objectContaining({ source: 'gadgets-source' }))
  })

  it('keeps running the rest after one --repo fails, reporting both outcomes', async () => {
    vi.mocked(addRepo).mockImplementation(async (_ctx, _dir, opts: { source: string }) => {
      if (opts.source === 'bad-source') throw new Error('boom')
      return fakeEntryResult('widgets')
    })

    const result = await runCreateWithRepos(ctx, 'demo', { repo: ['bad-source', 'widgets-source'] })

    expect(addRepo).toHaveBeenCalledTimes(2)
    expect(result.repoOutcomes[0]?.failure).toEqual({ source: 'bad-source', reason: 'boom', cancelled: false })
    expect(result.repoOutcomes[1]?.result?.entry.folder).toBe('widgets')
  })

  it('forwards --global to every repo added', async () => {
    vi.mocked(addRepo).mockResolvedValue(fakeEntryResult('widgets'))

    await runCreateWithRepos(ctx, 'demo', { repo: ['widgets-source'], global: true })

    expect(addRepo).toHaveBeenCalledWith(expect.anything(), '/ws/demo', expect.objectContaining({ global: true }))
  })

  it("logs each --repo's own progress line into its own task pane before adding it", async () => {
    vi.mocked(addRepo).mockResolvedValue(fakeEntryResult('widgets'))
    const logSpy = vi.fn()
    vi.mocked(runTasks).mockImplementationOnce(async (tasks) => {
      const [task] = tasks as FunctionTask[]
      await task?.run({ log: logSpy }, new AbortController().signal)
      return [{ name: task?.name ?? '', exitCode: null, signal: null, durationMs: 1, output: [], cancelled: false }]
    })

    await runCreateWithRepos(ctx, 'demo', { repo: ['widgets-source'] })

    expect(logSpy).toHaveBeenCalledWith('cloning/fetching widgets-source...')
  })
})

describe('runCreateWithRepos — interactive repo picker (no --repo given)', () => {
  it('does not prompt when there is nothing known to pick from', async () => {
    const result = await runCreateWithRepos(ctx, 'demo', {})

    expect(select).not.toHaveBeenCalled()
    expect(result.repoOutcomes).toEqual([])
  })

  it('offers a multi-select of known repos and adds whatever was chosen', async () => {
    vi.mocked(listRepoAliases).mockResolvedValue([{ alias: 'widgets', source: 'widgets-source', addedAt: '' }])
    vi.mocked(select).mockResolvedValue(['widgets-source'])
    vi.mocked(addRepo).mockResolvedValue(fakeEntryResult('widgets'))

    const result = await runCreateWithRepos(ctx, 'demo', {})

    expect(select).toHaveBeenCalledWith(expect.objectContaining({ mode: 'multi' }))
    expect(addRepo).toHaveBeenCalledWith(expect.anything(), '/ws/demo', expect.objectContaining({ source: 'widgets-source' }))
    expect(result.repoOutcomes[0]?.result?.entry.folder).toBe('widgets')
  })

  it('falls back to no repos (same as today) when the terminal cannot support a prompt', async () => {
    vi.mocked(listRepoAliases).mockResolvedValue([{ alias: 'widgets', source: 'widgets-source', addedAt: '' }])
    vi.mocked(select).mockRejectedValue(new NotInteractiveError())

    const result = await runCreateWithRepos(ctx, 'demo', {})

    expect(result.repoOutcomes).toEqual([])
    expect(addRepo).not.toHaveBeenCalled()
  })

  it('throws Cancelled when the user backs out of the picker', async () => {
    vi.mocked(listRepoAliases).mockResolvedValue([{ alias: 'widgets', source: 'widgets-source', addedAt: '' }])
    vi.mocked(select).mockResolvedValue(null)

    await expect(runCreateWithRepos(ctx, 'demo', {})).rejects.toThrow(SporkError)
  })

  it('re-throws a real failure from the picker rather than swallowing it', async () => {
    vi.mocked(listRepoAliases).mockResolvedValue([{ alias: 'widgets', source: 'widgets-source', addedAt: '' }])
    vi.mocked(select).mockRejectedValue(new Error('terminal exploded'))

    await expect(runCreateWithRepos(ctx, 'demo', {})).rejects.toThrow('terminal exploded')
  })
})

function fakeEntryResult(folder: string) {
  return { entry: fakeEntry(folder), aliasScope: 'local' as const, submodulesInitialized: false }
}

describe('registerCreateCommand', () => {
  it('wires the create command and prints a confirmation', async () => {
    const program = new Command()
    registerCreateCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'create', 'demo', '--dir', '/custom'])

    expect(createWorkspace).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, { name: 'demo', dir: '/custom' })
    expect(logSpy.mock.calls.flat().join('\n')).toContain('Created workspace "demo"')
    logSpy.mockRestore()
  })

  it('accepts repeated --repo flags and prints each result', async () => {
    vi.mocked(addRepo)
      .mockImplementationOnce(async () => ({ entry: fakeEntry('widgets'), aliasScope: 'local', submodulesInitialized: false }))
      .mockImplementationOnce(async () => ({ entry: fakeEntry('gadgets'), aliasScope: 'local', submodulesInitialized: true }))
    const program = new Command()
    registerCreateCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'create', 'demo', '--repo', 'widgets-source', '--repo', 'gadgets-source'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('"widgets"')
    expect(output).toContain('"gadgets"')
    expect(output).toContain('Initialized submodules in "gadgets"')
    expect(output).not.toContain('Add a repo with')
    logSpy.mockRestore()
  })

  it('prints every outcome then throws when a --repo fails, so the process exits non-zero', async () => {
    vi.mocked(addRepo).mockImplementation(async (_ctx, _dir, opts: { source: string }) => {
      if (opts.source === 'bad-source') throw new Error('boom')
      return fakeEntryResult('widgets')
    })
    const program = new Command()
    registerCreateCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const run = program.parseAsync(['node', 'test', 'create', 'demo', '--repo', 'bad-source', '--repo', 'widgets-source'])
    await expect(run).rejects.toThrow(/1 of 2 --repo adds did not succeed/)

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Failed to add "bad-source": boom')
    expect(output).toContain('"widgets"')
    logSpy.mockRestore()
  })
})
