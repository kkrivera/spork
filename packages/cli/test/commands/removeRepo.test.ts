import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FunctionTask, TaskResult } from '@spork/task-runner'

vi.mock('@spork/core', () => ({
  removeRepo: vi.fn(),
  resolveWorkspaceDir: vi.fn(),
  reconcileWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  findEnclosingWorkspaceDir: vi.fn(),
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

const { removeRepo, resolveWorkspaceDir, reconcileWorkspace, listWorkspaces, findEnclosingWorkspaceDir, SporkError } = await import('@spork/core')
const { select, confirm } = await import('@spork/prompts')
const { runTasks } = await import('@spork/task-runner')
const { runRemoveRepo, registerRemoveRepoCommand } = await import('../../src/commands/workspace/removeRepo.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

const manifestWithTwoWorktrees = {
  manifest: {
    name: 'demo',
    createdAt: '',
    worktrees: [
      { folder: 'widgets', source: 'git@github.com:acme/widgets.git', requestedRef: 'HEAD', localBranch: 'demo', addedAt: '' },
      { folder: 'gadgets', source: 'git@github.com:acme/gadgets.git', requestedRef: 'HEAD', localBranch: 'demo', addedAt: '' },
    ],
  },
  removedFolders: [],
}

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
  vi.mocked(removeRepo).mockReset().mockResolvedValue(undefined)
  vi.mocked(reconcileWorkspace).mockReset().mockResolvedValue(manifestWithTwoWorktrees)
  vi.mocked(listWorkspaces).mockReset().mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
  vi.mocked(findEnclosingWorkspaceDir).mockReset().mockReturnValue(null)
  vi.mocked(select).mockReset()
  vi.mocked(confirm).mockReset().mockResolvedValue(true)
  vi.mocked(runTasks)
    .mockReset()
    .mockImplementation((tasks) => fakeRunTasks(tasks as FunctionTask[]))
})

describe('runRemoveRepo', () => {
  it('resolves the workspace and removes the named folder', async () => {
    const { workspace, outcomes } = await runRemoveRepo(ctx, ['widgets'], { workspace: 'demo', yes: true })

    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(removeRepo).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/ws/demo', 'widgets')
    expect(workspace).toBe('demo')
    expect(outcomes).toEqual([{ folder: 'widgets', removed: true, reason: undefined }])
  })

  it('removes every folder given, concurrently', async () => {
    const { outcomes } = await runRemoveRepo(ctx, ['widgets', 'gadgets'], { workspace: 'demo', yes: true })

    expect(removeRepo).toHaveBeenCalledTimes(2)
    expect(outcomes).toEqual([
      { folder: 'widgets', removed: true, reason: undefined },
      { folder: 'gadgets', removed: true, reason: undefined },
    ])
  })

  it('reports one failure without losing the others (best-effort, not fail-fast)', async () => {
    vi.mocked(removeRepo).mockImplementation((_ctx, _dir, folder) =>
      folder === 'widgets' ? Promise.reject(new Error('disk full')) : Promise.resolve(undefined),
    )

    const { outcomes } = await runRemoveRepo(ctx, ['widgets', 'gadgets'], { workspace: 'demo', yes: true })

    expect(outcomes).toEqual([
      { folder: 'widgets', removed: false, reason: 'disk full' },
      { folder: 'gadgets', removed: true, reason: undefined },
    ])
  })
})

describe('runRemoveRepo — destructive confirmation', () => {
  it('asks for confirmation before removing, unless --yes was passed', async () => {
    await runRemoveRepo(ctx, ['widgets'], { workspace: 'demo' })

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('widgets') }))
    expect(removeRepo).toHaveBeenCalled()
  })

  it('throws Cancelled when the user declines the confirmation', async () => {
    vi.mocked(confirm).mockResolvedValue(false)

    await expect(runRemoveRepo(ctx, ['widgets'], { workspace: 'demo' })).rejects.toThrow(SporkError)
    expect(removeRepo).not.toHaveBeenCalled()
  })
})

describe('runRemoveRepo — resolving the workspace', () => {
  it('picks the workspace when --workspace was omitted', async () => {
    vi.mocked(select).mockResolvedValueOnce(['demo'])

    const { workspace } = await runRemoveRepo(ctx, ['widgets'], { yes: true })

    expect(select).toHaveBeenCalledWith(expect.objectContaining({ mode: 'single' }))
    expect(workspace).toBe('demo')
  })

  it('auto-detects the enclosing workspace from cwd, without prompting', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')

    const { workspace } = await runRemoveRepo(ctx, ['widgets'], { yes: true })

    expect(select).not.toHaveBeenCalled()
    expect(workspace).toBe('demo')
  })
})

describe('runRemoveRepo — picking folders from a list', () => {
  it('offers a multi-select of the resolved workspace\'s worktrees when no folders are given', async () => {
    vi.mocked(select).mockResolvedValue(['widgets', 'gadgets'])

    const { outcomes } = await runRemoveRepo(ctx, [], { workspace: 'demo', yes: true })

    expect(select).toHaveBeenCalledWith(expect.objectContaining({ mode: 'multi', message: expect.stringContaining('demo') }))
    expect(outcomes.map((o) => o.folder)).toEqual(['widgets', 'gadgets'])
  })

  it('refuses when the resolved workspace has no repos to remove', async () => {
    vi.mocked(reconcileWorkspace).mockResolvedValue({ manifest: { name: 'demo', createdAt: '', worktrees: [] }, removedFolders: [] })

    await expect(runRemoveRepo(ctx, [], { workspace: 'demo', yes: true })).rejects.toThrow(SporkError)
  })
})

describe('registerRemoveRepoCommand', () => {
  it('wires the remove-repo command and prints a confirmation', async () => {
    const program = new Command()
    registerRemoveRepoCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'remove-repo', 'widgets', '--workspace', 'demo', '--yes'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Removed "widgets"')
    logSpy.mockRestore()
  })

  it('prints each failure and throws afterward, keeping the exit code non-zero', async () => {
    vi.mocked(removeRepo).mockImplementation((_ctx, _dir, folder) =>
      folder === 'widgets' ? Promise.reject(new Error('disk full')) : Promise.resolve(undefined),
    )
    const program = new Command()
    registerRemoveRepoCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(program.parseAsync(['node', 'test', 'remove-repo', 'widgets', 'gadgets', '--workspace', 'demo', '--yes'])).rejects.toThrow(
      SporkError,
    )

    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Failed to remove "widgets": disk full')
    expect(output).toContain('Removed "gadgets"')
    logSpy.mockRestore()
  })
})
