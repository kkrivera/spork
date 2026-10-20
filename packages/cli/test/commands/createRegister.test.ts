import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FunctionTask, TaskResult } from '@spork/task-runner'
import type { LaunchDeps } from '../../src/launchTarget.js'

vi.mock('@spork/core', () => ({
  createAndRegisterWorkspace: vi.fn(),
  addRepo: vi.fn(),
  defaultAlias: (source: string) => source,
  resolveWorkspaceDir: vi.fn(),
  findEnclosingWorkspaceDir: vi.fn(),
  listRepoAliases: vi.fn(),
  localRepoRegistryPath: (workspaceDir: string) => `${workspaceDir}/spork.repos.json`,
  codeWorkspaceFilePath: vi.fn(),
  SporkError: class SporkError extends Error {},
}))
vi.mock('@spork/task-runner', () => ({
  runTasks: vi.fn(),
}))
vi.mock('@spork/prompts', () => ({
  select: vi.fn(),
  NotInteractiveError: class NotInteractiveError extends Error {},
}))

const { createAndRegisterWorkspace, addRepo, resolveWorkspaceDir, findEnclosingWorkspaceDir, listRepoAliases, codeWorkspaceFilePath } =
  await import('@spork/core')
const { runTasks } = await import('@spork/task-runner')
const { select, NotInteractiveError } = await import('@spork/prompts')
const { registerCreateCommand } = await import('../../src/commands/workspace/create.js')
const { createUi } = await import('../../src/output/color.js')

function fakeDeps(openOutcome: { ok: boolean; reason?: string }, claudeImpl?: () => Promise<unknown>): LaunchDeps {
  return {
    opener: { open: vi.fn().mockResolvedValue(openOutcome) },
    executor: { run: vi.fn().mockImplementation(claudeImpl ?? (async () => ({ exitCode: 0, signal: null }))) },
  }
}

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }), env: {} }

function fakeEntry(folder: string) {
  return { folder, source: `git@github.com:acme/${folder}.git`, requestedRef: 'HEAD', localBranch: 'demo', addedAt: '' }
}

function fakeEntryResult(folder: string) {
  return { entry: fakeEntry(folder), aliasScope: 'local' as const, submodulesInitialized: false }
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
  vi.mocked(createAndRegisterWorkspace)
    .mockReset()
    .mockResolvedValue({ name: 'demo', dir: '/ws/demo', manifest: { name: 'demo', createdAt: '', worktrees: [] } })
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(addRepo).mockReset()
  vi.mocked(findEnclosingWorkspaceDir).mockReset().mockReturnValue(null)
  vi.mocked(listRepoAliases).mockReset().mockResolvedValue([])
  vi.mocked(codeWorkspaceFilePath).mockReset().mockReturnValue('/ws/demo/demo.code-workspace')
  vi.mocked(select).mockReset().mockResolvedValue(['skip'])
  vi.mocked(runTasks)
    .mockReset()
    .mockImplementation((tasks) => fakeRunTasks(tasks as FunctionTask[]))
})

describe('registerCreateCommand', () => {
  it('wires the create command and prints a confirmation', async () => {
    const program = new Command()
    registerCreateCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'create', 'demo', '--dir', '/custom'])

    expect(createAndRegisterWorkspace).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/repos.json' },
      '/registry.json',
      { name: 'demo', dir: '/custom/demo' },
    )
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

describe('registerCreateCommand — offer to launch', () => {
  it('opens the workspace in VS Code when chosen, after everything else has printed', async () => {
    vi.mocked(select).mockResolvedValue(['code'])
    const deps = fakeDeps({ ok: true })
    const program = new Command()
    registerCreateCommand(program, ctx, deps)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'create', 'demo'])

    expect(select).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('demo') }))
    expect(deps.opener.open).toHaveBeenCalledWith('/ws/demo/demo.code-workspace')
    expect(logSpy.mock.calls.flat().join('\n')).toContain('Opened /ws/demo/demo.code-workspace')
    logSpy.mockRestore()
  })

  it('launches claude, cwd’d into the workspace, when chosen', async () => {
    vi.mocked(select).mockResolvedValue(['claude'])
    const deps = fakeDeps({ ok: true })
    const program = new Command()
    registerCreateCommand(program, ctx, deps)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'create', 'demo'])

    expect(deps.executor.run).toHaveBeenCalledWith('claude', '/ws/demo')
    expect(deps.opener.open).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it('prints a manual fallback when the VS Code opener fails', async () => {
    vi.mocked(select).mockResolvedValue(['code'])
    const program = new Command()
    registerCreateCommand(program, ctx, fakeDeps({ ok: false, reason: 'not found' }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'create', 'demo'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('not found')
    expect(output).toContain('Open manually')
    logSpy.mockRestore()
  })

})

describe('registerCreateCommand — offer to launch, failures', () => {
  it('prints a manual fallback when claude fails to launch', async () => {
    vi.mocked(select).mockResolvedValue(['claude'])
    const deps = fakeDeps({ ok: true }, async () => {
      throw new Error('boom')
    })
    const program = new Command()
    registerCreateCommand(program, ctx, deps)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'create', 'demo'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('boom')
    expect(output).toContain('cd /ws/demo && claude')
    logSpy.mockRestore()
  })

  it('prints how to open it later when "Not now" is chosen, without launching anything', async () => {
    vi.mocked(select).mockResolvedValue(['skip'])
    const deps = fakeDeps({ ok: true })
    const program = new Command()
    registerCreateCommand(program, ctx, deps)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'create', 'demo'])

    expect(deps.opener.open).not.toHaveBeenCalled()
    expect(deps.executor.run).not.toHaveBeenCalled()
    expect(logSpy.mock.calls.flat().join('\n')).toContain('Open later with: spork workspace open demo')
    logSpy.mockRestore()
  })
})

describe('registerCreateCommand — offer to launch, edge cases', () => {
  it('skips silently, without printing or launching anything, when the terminal cannot prompt', async () => {
    vi.mocked(select).mockRejectedValue(new NotInteractiveError())
    const deps = fakeDeps({ ok: true })
    const program = new Command()
    registerCreateCommand(program, ctx, deps)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'create', 'demo'])

    expect(deps.opener.open).not.toHaveBeenCalled()
    expect(deps.executor.run).not.toHaveBeenCalled()
    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).not.toContain('Open')
    logSpy.mockRestore()
  })

  it('re-throws a real picker failure rather than swallowing it', async () => {
    vi.mocked(select).mockRejectedValue(new Error('terminal exploded'))
    const program = new Command()
    registerCreateCommand(program, ctx, fakeDeps({ ok: true }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const run = program.parseAsync(['node', 'test', 'create', 'demo'])

    await expect(run).rejects.toThrow('terminal exploded')
    logSpy.mockRestore()
  })

  it('still offers to launch even when no repos were added', async () => {
    vi.mocked(select).mockResolvedValue(['code'])
    const deps = fakeDeps({ ok: true })
    const program = new Command()
    registerCreateCommand(program, ctx, deps)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'create', 'demo'])

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Add a repo with')
    expect(deps.opener.open).toHaveBeenCalled()
    logSpy.mockRestore()
  })
})
