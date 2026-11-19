import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spork/core', () => ({
  resolveWorkspaceDir: vi.fn(),
  markWorkspaceUsed: vi.fn(),
}))

const { resolveWorkspaceDir, markWorkspaceUsed } = await import('@spork/core')
const { resolveUsedWorkspaceDir } = await import('../../src/commands/workspace/useWorkspace.js')
const { createUi } = await import('../../src/output/color.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }), env: {} }

beforeEach(() => {
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(markWorkspaceUsed).mockReset().mockResolvedValue(undefined)
})

describe('resolveUsedWorkspaceDir', () => {
  it('resolves the workspace and records it as just used, by its directory', async () => {
    expect(await resolveUsedWorkspaceDir(ctx, 'demo')).toBe('/ws/demo')
    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(markWorkspaceUsed).toHaveBeenCalledWith('/registry.json', '/ws/demo')
  })

  it("still returns the directory when recording the use fails", async () => {
    vi.mocked(markWorkspaceUsed).mockRejectedValue(new Error('EACCES'))

    expect(await resolveUsedWorkspaceDir(ctx, 'demo')).toBe('/ws/demo')
  })

  it("doesn't record anything when the workspace can't be resolved", async () => {
    vi.mocked(resolveWorkspaceDir).mockRejectedValue(new Error('No workspace named "x"'))

    await expect(resolveUsedWorkspaceDir(ctx, 'x')).rejects.toThrow('No workspace named')
    expect(markWorkspaceUsed).not.toHaveBeenCalled()
  })
})
