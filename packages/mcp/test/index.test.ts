import { describe, expect, it, vi } from 'vitest'

const connect = vi.fn().mockResolvedValue(undefined)
const fakeServerInstance = { connect }

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(() => fakeServerInstance),
}))
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}))
vi.mock('../src/tools/index.js', () => ({
  registerTools: vi.fn(),
}))

const { createServer, main } = await import('../src/index.js')
const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
const { registerTools } = await import('../src/tools/index.js')

describe('createServer', () => {
  it('builds an McpServer named "spork"', () => {
    createServer()

    expect(McpServer).toHaveBeenCalledWith({ name: 'spork', version: '0.1.0' })
  })

  it('registers every tool against the new server', () => {
    createServer()

    expect(registerTools).toHaveBeenCalledWith(
      fakeServerInstance,
      expect.objectContaining({ reposRoot: expect.any(String), registryPath: expect.any(String), repoRegistryPath: expect.any(String) }),
    )
  })
})

describe('main', () => {
  it('connects the server over a stdio transport', async () => {
    await main()

    expect(connect).toHaveBeenCalledTimes(1)
  })
})
