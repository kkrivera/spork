import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createFakeServer } from '../fakeServer.js'

vi.mock('@spork/core', () => ({
  listWorkspacesByRecentUse: vi.fn(),
}))

const { listWorkspacesByRecentUse } = await import('@spork/core')
const { registerListWorkspacesTool } = await import('../../src/tools/listWorkspaces.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json' }

beforeEach(() => {
  vi.mocked(listWorkspacesByRecentUse).mockReset()
})

describe('registerListWorkspacesTool', () => {
  it('registers "list_workspaces" with a description and no input', () => {
    const { server, tools } = createFakeServer()

    registerListWorkspacesTool(server as unknown as McpServer, ctx)

    expect(tools).toHaveLength(1)
    expect(tools[0]?.name).toBe('list_workspaces')
    expect(tools[0]?.config.description).toContain('workspace')
  })

  it('returns every registered workspace as JSON', async () => {
    vi.mocked(listWorkspacesByRecentUse).mockResolvedValue([{ name: 'demo', dir: '/ws/demo' }])
    const { server, tools } = createFakeServer()
    registerListWorkspacesTool(server as unknown as McpServer, ctx)

    const result = await tools[0]?.handler({})

    expect(listWorkspacesByRecentUse).toHaveBeenCalledWith('/registry.json')
    expect(JSON.parse(result?.content[0]?.text ?? '')).toEqual([{ name: 'demo', dir: '/ws/demo' }])
  })
})
