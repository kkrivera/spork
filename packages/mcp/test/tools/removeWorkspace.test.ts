import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createFakeServer } from '../fakeServer.js'

vi.mock('@spork/core', () => ({
  removeAndUnregisterWorkspace: vi.fn(),
  resolveWorkspaceDir: vi.fn(),
}))

const { removeAndUnregisterWorkspace, resolveWorkspaceDir } = await import('@spork/core')
const { registerRemoveWorkspaceTool } = await import('../../src/tools/removeWorkspace.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json' }

beforeEach(() => {
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(removeAndUnregisterWorkspace).mockReset().mockResolvedValue(undefined)
})

describe('registerRemoveWorkspaceTool', () => {
  it('registers "remove_workspace" with workspace required and keepFiles optional', () => {
    const { server, tools } = createFakeServer()

    registerRemoveWorkspaceTool(server as unknown as McpServer, ctx)

    expect(tools[0]?.name).toBe('remove_workspace')
    expect(tools[0]?.config.inputSchema).toHaveProperty('workspace')
    expect(tools[0]?.config.inputSchema).toHaveProperty('keepFiles')
  })

  it('resolves the workspace and removes it, with no confirmation prompt', async () => {
    const { server, tools } = createFakeServer()
    registerRemoveWorkspaceTool(server as unknown as McpServer, ctx)

    const result = await tools[0]?.handler({ workspace: 'demo' })

    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(removeAndUnregisterWorkspace).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/repos.json' },
      '/registry.json',
      '/ws/demo',
      { keepFiles: undefined },
    )
    expect(result?.content[0]?.text).toContain('Removed workspace "demo"')
  })

  it('forwards keepFiles', async () => {
    const { server, tools } = createFakeServer()
    registerRemoveWorkspaceTool(server as unknown as McpServer, ctx)

    await tools[0]?.handler({ workspace: 'demo', keepFiles: true })

    expect(removeAndUnregisterWorkspace).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), { keepFiles: true })
  })
})
