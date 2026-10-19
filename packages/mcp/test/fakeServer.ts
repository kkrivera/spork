import { vi } from 'vitest'

export interface RegisteredTool {
  name: string
  config: { description?: string; inputSchema?: Record<string, unknown> }
  handler: (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[] }>
}

/** A minimal fake `McpServer` that just records every `registerTool` call, so a test can invoke a tool's handler directly without a real MCP connection. */
export function createFakeServer(): { server: { registerTool: ReturnType<typeof vi.fn> }; tools: RegisteredTool[] } {
  const tools: RegisteredTool[] = []
  const server = {
    registerTool: vi.fn((name: string, config: RegisteredTool['config'], handler: RegisteredTool['handler']) => {
      tools.push({ name, config, handler })
    }),
  }
  return { server, tools }
}
