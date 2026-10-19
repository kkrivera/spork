import { describe, expect, it, vi } from 'vitest'

const connect = vi.fn().mockResolvedValue(undefined)

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(() => ({ connect })),
}))
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}))

const { createServer, main } = await import('../src/index.js')
const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

describe('createServer', () => {
  it('builds an McpServer named "spork"', () => {
    createServer()

    expect(McpServer).toHaveBeenCalledWith({ name: 'spork', version: '0.1.0' })
  })
})

describe('main', () => {
  it('connects the server over a stdio transport', async () => {
    await main()

    expect(connect).toHaveBeenCalledTimes(1)
  })
})
