import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FunctionTask, TaskResult } from '@spork/task-runner'

vi.mock('@spork/core', () => ({
  listWorkspaces: vi.fn(),
  removeWorkspace: vi.fn(),
  resolveWorkspaceDir: vi.fn(),
  unregisterWorkspace: vi.fn(),
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

const { listWorkspaces, removeWorkspace, resolveWorkspaceDir, unregisterWorkspace, SporkError } = await import('@spork/core')
const { select, confirm } = await import('@spork/prompts')
const { runTasks } = await import('@spork/task-runner')
const { runRemove, registerRemoveCommand } = await import('../../src/commands/workspace/remove.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

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
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(removeWorkspace).mockReset().mockResolvedValue(undefined)
  vi.mocked(listWorkspaces).mockReset().mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
  vi.mocked(unregisterWorkspace).mockReset().mockResolvedValue(undefined)
  vi.mocked(select).mockReset()
  vi.mocked(confirm).mockReset().mockResolvedValue(true)
  vi.mocked(runTasks)
    .mockReset()
    .mockImplementation((tasks) => fakeRunTasks(tasks as FunctionTask[]))
})

describe('runRemove', () => {
  it('removes the workspace and unregisters its matching registry entry', async () => {
    const outcomes = await runRemove(ctx, ['demo'], { yes: true })

    expect(removeWorkspace).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/ws/demo', { keepFiles: undefined })
    expect(unregisterWorkspace).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(outcomes).toEqual([{ name: 'demo', removed: true, reason: undefined }])
  })

  it('forwards keepFiles', async () => {
    await runRemove(ctx, ['demo'], { keepFiles: true, yes: true })

    expect(removeWorkspace).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/ws/demo', { keepFiles: true })
  })

  it('does not try to unregister when nothing in the registry matches the resolved dir', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([])

    await runRemove(ctx, ['/ws/demo'], { yes: true })

    expect(unregisterWorkspace).not.toHaveBeenCalled()
  })

  it('removes every workspace given, concurrently', async () => {
    vi.mocked(resolveWorkspaceDir).mockImplementation((_registry, name) => Promise.resolve(`/ws/${name}`))
    vi.mocked(listWorkspaces).mockResolvedValue([
      { name: 'a', dir: '/ws/a' },
      { name: 'b', dir: '/ws/b' },
    ])

    const outcomes = await runRemove(ctx, ['a', 'b'], { yes: true })

    expect(removeWorkspace).toHaveBeenCalledTimes(2)
    expect(outcomes).toEqual([
      { name: 'a', removed: true, reason: undefined },
      { name: 'b', removed: true, reason: undefined },
    ])
  })

  it('reports one failure without losing the others (best-effort, not fail-fast)', async () => {
    vi.mocked(resolveWorkspaceDir).mockImplementation((_registry, name) => Promise.resolve(`/ws/${name}`))
    vi.mocked(listWorkspaces).mockResolvedValue([
      { name: 'a', dir: '/ws/a' },
      { name: 'b', dir: '/ws/b' },
    ])
    vi.mocked(removeWorkspace).mockImplementation((_ctx, dir) =>
      dir === '/ws/a' ? Promise.reject(new Error('disk full')) : Promise.resolve(undefined),
    )

    const outcomes = await runRemove(ctx, ['a', 'b'], { yes: true })

    expect(outcomes).toEqual([
      { name: 'a', removed: false, reason: 'disk full' },
      { name: 'b', removed: true, reason: undefined },
    ])
  })
})

describe('runRemove — destructive confirmation', () => {
  it('asks for confirmation before removing, unless --yes was passed', async () => {
    await runRemove(ctx, ['demo'], {})

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('demo') }))
    expect(removeWorkspace).toHaveBeenCalled()
  })

  it('skips the confirmation entirely when --yes is passed', async () => {
    await runRemove(ctx, ['demo'], { yes: true })

    expect(confirm).not.toHaveBeenCalled()
  })

  it('throws Cancelled when the user declines the confirmation', async () => {
    vi.mocked(confirm).mockResolvedValue(false)

    await expect(runRemove(ctx, ['demo'], {})).rejects.toThrow(SporkError)
    expect(removeWorkspace).not.toHaveBeenCalled()
  })
})

describe('runRemove — picking from a list (no workspace given)', () => {
  it('offers a multi-select of registered workspaces', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([
      { name: 'demo', dir: '/ws/demo' },
      { name: 'other', dir: '/ws/other' },
    ])
    vi.mocked(select).mockResolvedValue(['other'])
    vi.mocked(resolveWorkspaceDir).mockResolvedValue('/ws/other')

    const outcomes = await runRemove(ctx, [], { yes: true })

    expect(select).toHaveBeenCalledWith(expect.objectContaining({ mode: 'multi' }))
    expect(outcomes).toEqual([{ name: 'other', removed: true, reason: undefined }])
  })

  it('refuses with a clear error when nothing is registered yet', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([])

    await expect(runRemove(ctx, [], { yes: true })).rejects.toThrow(SporkError)
    expect(select).not.toHaveBeenCalled()
  })
})

describe('registerRemoveCommand', () => {
  it('wires the remove command and prints a confirmation', async () => {
    const program = new Command()
    registerRemoveCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'remove', 'demo', '--keep-files', '--yes'])

    expect(removeWorkspace).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/ws/demo', { keepFiles: true })
    expect(logSpy.mock.calls.flat().join('\n')).toContain('Removed workspace "demo"')
    logSpy.mockRestore()
  })

  it('prints each failure and throws afterward, keeping the exit code non-zero', async () => {
    vi.mocked(resolveWorkspaceDir).mockImplementation((_registry, name) => Promise.resolve(`/ws/${name}`))
    vi.mocked(listWorkspaces).mockResolvedValue([
      { name: 'a', dir: '/ws/a' },
      { name: 'b', dir: '/ws/b' },
    ])
    vi.mocked(removeWorkspace).mockImplementation((_ctx, dir) =>
      dir === '/ws/a' ? Promise.reject(new Error('disk full')) : Promise.resolve(undefined),
    )
    const program = new Command()
    registerRemoveCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(program.parseAsync(['node', 'test', 'remove', 'a', 'b', '--yes'])).rejects.toThrow(SporkError)

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Failed to remove "a": disk full')
    expect(output).toContain('Removed workspace "b"')
    logSpy.mockRestore()
  })
})
