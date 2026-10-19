import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createFakeServer } from '../fakeServer.js'

vi.mock('@spork/core', () => ({
  removeRepo: vi.fn(),
  resolveWorkspaceDir: vi.fn(),
}))

const { removeRepo, resolveWorkspaceDir } = await import('@spork/core')
const { registerRemoveRepoTool } = await import('../../src/tools/removeRepo.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json' }

beforeEach(() => {
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(removeRepo).mockReset().mockResolvedValue(undefined)
})

describe('registerRemoveRepoTool', () => {
  it('registers "remove_repo" with workspace and folder required', () => {
    const { server, tools } = createFakeServer()

    registerRemoveRepoTool(server as unknown as McpServer, ctx)

    expect(tools[0]?.name).toBe('remove_repo')
    expect(tools[0]?.config.inputSchema).toHaveProperty('workspace')
    expect(tools[0]?.config.inputSchema).toHaveProperty('folder')
  })

  it('resolves the workspace and removes the named folder', async () => {
    const { server, tools } = createFakeServer()
    registerRemoveRepoTool(server as unknown as McpServer, ctx)

    const result = await tools[0]?.handler({ workspace: 'demo', folder: 'widgets' })

    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(removeRepo).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/ws/demo', 'widgets')
    expect(result?.content[0]?.text).toContain('Removed "widgets"')
  })
})
