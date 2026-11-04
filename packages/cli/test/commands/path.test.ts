import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const { resolveWorkspaceDir, listWorkspaces, findEnclosingWorkspaceDir } = await import('@spork/core')
const { select } = await import('@spork/prompts')
const { runPath, registerPathCommand } = await import('../../src/commands/workspace/path.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }), env: {} }

beforeEach(() => {
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(listWorkspaces).mockReset().mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
  vi.mocked(findEnclosingWorkspaceDir).mockReset().mockReturnValue(null)
  vi.mocked(select).mockReset()
})

describe('runPath', () => {
  it("resolves a named workspace's directory", async () => {
    expect(await runPath(ctx, 'demo')).toBe('/ws/demo')
    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(select).not.toHaveBeenCalled()
  })

  it('picks one on stderr when none is given, keeping stdout for the path', async () => {
    vi.mocked(select).mockResolvedValue(['demo'])

    expect(await runPath(ctx, undefined)).toBe('/ws/demo')
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ mode: 'single', output: process.stderr }))
  })
})

describe('registerPathCommand', () => {
  it('prints only the path', async () => {
    const program = new Command()
    registerPathCommand(program, ctx)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'path', 'demo'])

    expect(logSpy.mock.calls).toEqual([['/ws/demo']])
    logSpy.mockRestore()
  })
})
