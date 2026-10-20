import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandExecutor, ExecResult } from '../../src/commandExecutor.js'

vi.mock('@spork/core', () => ({
  resolveWorkspaceDir: vi.fn(),
  listWorkspaces: vi.fn(),
  findEnclosingWorkspaceDir: vi.fn(),
  SporkError: class SporkError extends Error {},
}))
vi.mock('@spork/prompts', () => ({
  select: vi.fn(),
  NotInteractiveError: class NotInteractiveError extends Error {},
}))

const { resolveWorkspaceDir, listWorkspaces, findEnclosingWorkspaceDir, SporkError } = await import('@spork/core')
const { select } = await import('@spork/prompts')
const { runExec, registerExecCommand } = await import('../../src/commands/workspace/exec.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }), env: {} }

function fakeExecutor(result: ExecResult): CommandExecutor {
  return { run: vi.fn().mockResolvedValue(result) }
}

beforeEach(() => {
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(listWorkspaces).mockReset().mockResolvedValue([])
  vi.mocked(findEnclosingWorkspaceDir).mockReset().mockReturnValue(null)
  vi.mocked(select).mockReset()
})

afterEach(() => {
  process.exitCode = 0
})

describe('runExec', () => {
  it('resolves the given workspace and runs the command at its root', async () => {
    const executor = fakeExecutor({ exitCode: 0, signal: null })

    const result = await runExec(ctx, 'npm run dev', { workspace: 'demo' }, executor)

    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(executor.run).toHaveBeenCalledWith('npm run dev', '/ws/demo')
    expect(result).toEqual({ workspace: 'demo', dir: '/ws/demo', exitCode: 0, signal: null })
  })

  it('calls onResolved with the workspace/dir before running, not after', async () => {
    const order: string[] = []
    const executor: CommandExecutor = {
      run: vi.fn().mockImplementation(async () => {
        order.push('run')
        return { exitCode: 0, signal: null }
      }),
    }

    await runExec(ctx, 'npm run dev', { workspace: 'demo' }, executor, () => order.push('resolved'))

    expect(order).toEqual(['resolved', 'run'])
  })

  it('propagates a non-zero exit code without throwing', async () => {
    const executor = fakeExecutor({ exitCode: 1, signal: null })

    const result = await runExec(ctx, 'npm test', { workspace: 'demo' }, executor)

    expect(result.exitCode).toBe(1)
  })
})

describe('runExec — resolving the workspace when --workspace is omitted', () => {
  it('auto-detects the enclosing workspace from cwd, without prompting', async () => {
    vi.mocked(findEnclosingWorkspaceDir).mockReturnValue('/ws/demo')
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    const executor = fakeExecutor({ exitCode: 0, signal: null })

    const result = await runExec(ctx, 'npm run dev', {}, executor)

    expect(select).not.toHaveBeenCalled()
    expect(result.workspace).toBe('demo')
  })

  it('offers a single-select when cwd is not inside a workspace', async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    vi.mocked(select).mockResolvedValue(['demo'])
    const executor = fakeExecutor({ exitCode: 0, signal: null })

    const result = await runExec(ctx, 'npm run dev', {}, executor)

    expect(select).toHaveBeenCalledWith(expect.objectContaining({ mode: 'single' }))
    expect(result.workspace).toBe('demo')
  })

  it('refuses with a clear error when nothing is registered yet', async () => {
    const executor = fakeExecutor({ exitCode: 0, signal: null })

    await expect(runExec(ctx, 'npm run dev', {}, executor)).rejects.toThrow(SporkError)
  })
})

describe('registerExecCommand', () => {
  it('wires the exec command, printing where it ran and propagating the exit code', async () => {
    const executor = fakeExecutor({ exitCode: 3, signal: null })
    const program = new Command()
    registerExecCommand(program, ctx, executor)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'exec', 'npm test', '--workspace', 'demo'])

    expect(logSpy.mock.calls.flat().join('\n')).toContain('Running "npm test" in "demo"')
    expect(process.exitCode).toBe(3)
    logSpy.mockRestore()
  })

  it('treats a signal-terminated command as a failing exit code', async () => {
    const executor = fakeExecutor({ exitCode: null, signal: 'SIGINT' })
    const program = new Command()
    registerExecCommand(program, ctx, executor)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'exec', 'npm run dev', '--workspace', 'demo'])

    expect(process.exitCode).toBe(1)
    logSpy.mockRestore()
  })
})
