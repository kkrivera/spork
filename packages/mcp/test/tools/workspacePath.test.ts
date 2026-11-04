import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createFakeServer } from '../fakeServer.js'

vi.mock('@spork/core', () => ({
  resolveWorkspaceDir: vi.fn(),
}))

const { resolveWorkspaceDir } = await import('@spork/core')
const { registerWorkspacePathTool } = await import('../../src/tools/workspacePath.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json' }

beforeEach(() => {
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
})

describe('registerWorkspacePathTool', () => {
  it('registers "workspace_path" with workspace required', () => {
    const { server, tools } = createFakeServer()

    registerWorkspacePathTool(server as unknown as McpServer, ctx)

    expect(tools[0]?.name).toBe('workspace_path')
    expect(tools[0]?.config.inputSchema).toHaveProperty('workspace')
  })

  it("returns the workspace's directory as plain text", async () => {
    const { server, tools } = createFakeServer()
    registerWorkspacePathTool(server as unknown as McpServer, ctx)

    const result = await tools[0]?.handler({ workspace: 'demo' })

    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(result?.content[0]?.text).toBe('/ws/demo')
  })
})
