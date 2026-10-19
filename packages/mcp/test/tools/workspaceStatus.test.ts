import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createFakeServer } from '../fakeServer.js'

vi.mock('@spork/core', () => ({
  getWorkspaceStatus: vi.fn(),
  resolveWorkspaceDir: vi.fn(),
}))

const { getWorkspaceStatus, resolveWorkspaceDir } = await import('@spork/core')
const { registerWorkspaceStatusTool } = await import('../../src/tools/workspaceStatus.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json' }

beforeEach(() => {
  vi.mocked(resolveWorkspaceDir).mockReset().mockResolvedValue('/ws/demo')
  vi.mocked(getWorkspaceStatus).mockReset()
})

describe('registerWorkspaceStatusTool', () => {
  it('registers "workspace_status" with workspace required', () => {
    const { server, tools } = createFakeServer()

    registerWorkspaceStatusTool(server as unknown as McpServer, ctx)

    expect(tools[0]?.name).toBe('workspace_status')
    expect(tools[0]?.config.inputSchema).toHaveProperty('workspace')
  })

  it('resolves the workspace and returns its worktree statuses as JSON', async () => {
    vi.mocked(getWorkspaceStatus).mockResolvedValue([
      { folder: 'widgets', source: 'x', requestedRef: 'main', localBranch: 'demo', addedAt: '', status: { branch: 'demo', isClean: false, changedFiles: 3 } },
    ])
    const { server, tools } = createFakeServer()
    registerWorkspaceStatusTool(server as unknown as McpServer, ctx)

    const result = await tools[0]?.handler({ workspace: 'demo' })

    expect(resolveWorkspaceDir).toHaveBeenCalledWith('/registry.json', 'demo')
    expect(getWorkspaceStatus).toHaveBeenCalledWith({ reposRoot: '/repos', repoRegistryPath: '/repos.json' }, '/ws/demo')
    expect(JSON.parse(result?.content[0]?.text ?? '')).toEqual([
      { folder: 'widgets', source: 'x', requestedRef: 'main', localBranch: 'demo', addedAt: '', status: { branch: 'demo', isClean: false, changedFiles: 3 } },
    ])
  })
})
