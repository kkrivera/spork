import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createFakeServer } from '../fakeServer.js'

vi.mock('@spork/core', () => ({
  createAndRegisterWorkspace: vi.fn(),
}))

const { createAndRegisterWorkspace } = await import('@spork/core')
const { registerCreateWorkspaceTool } = await import('../../src/tools/createWorkspace.js')

const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json' }

beforeEach(() => {
  vi.mocked(createAndRegisterWorkspace)
    .mockReset()
    .mockResolvedValue({ name: 'demo', dir: '/parent/demo', manifest: { name: 'demo', createdAt: '', worktrees: [] } })
})

describe('registerCreateWorkspaceTool', () => {
  it('registers "create_workspace" with required name/dir input', () => {
    const { server, tools } = createFakeServer()

    registerCreateWorkspaceTool(server as unknown as McpServer, ctx)

    expect(tools[0]?.name).toBe('create_workspace')
    expect(tools[0]?.config.inputSchema).toHaveProperty('name')
    expect(tools[0]?.config.inputSchema).toHaveProperty('dir')
  })

  it('resolves dir to <dir>/<name> and reports where it landed', async () => {
    const { server, tools } = createFakeServer()
    registerCreateWorkspaceTool(server as unknown as McpServer, ctx)

    const result = await tools[0]?.handler({ name: 'demo', dir: '/parent' })

    expect(createAndRegisterWorkspace).toHaveBeenCalledWith(
      { reposRoot: '/repos', repoRegistryPath: '/repos.json' },
      '/registry.json',
      { name: 'demo', dir: '/parent/demo' },
    )
    expect(result?.content[0]?.text).toContain('/parent/demo')
  })

  it('propagates a duplicate-name rejection from core rather than swallowing it', async () => {
    vi.mocked(createAndRegisterWorkspace).mockRejectedValue(new Error('A workspace named "demo" is already registered.'))
    const { server, tools } = createFakeServer()
    registerCreateWorkspaceTool(server as unknown as McpServer, ctx)

    await expect(tools[0]?.handler({ name: 'demo', dir: '/parent' })).rejects.toThrow('already registered')
  })
})
