import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { listWorkspaces } from '@spork/core'
import type { McpContext } from '../context.js'
import { jsonResult } from '../textResult.js'

export function registerListWorkspacesTool(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    'list_workspaces',
    { description: 'List every registered spork workspace, with its name and directory.' },
    async () => jsonResult(await listWorkspaces(ctx.registryPath)),
  )
}
