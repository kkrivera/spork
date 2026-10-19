#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpContext } from './context.js'
import { registerTools } from './tools/index.js'

export function createServer(): McpServer {
  const server = new McpServer({ name: 'spork', version: '0.1.0' })
  registerTools(server, createMcpContext())
  return server
}

export async function main(): Promise<void> {
  const server = createServer()
  await server.connect(new StdioServerTransport())
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
