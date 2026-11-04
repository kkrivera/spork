import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { resolveWorkspaceDir } from '@spork/core'
import { z } from 'zod'
import type { McpContext } from '../context.js'
import { textResult } from '../textResult.js'

export function registerWorkspacePathTool(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    'workspace_path',
    {
      description: "Get a workspace's full directory path, e.g. to run commands or read files at its root.",
      inputSchema: { workspace: z.string().describe('Workspace name') },
    },
    async ({ workspace }) => textResult(await resolveWorkspaceDir(ctx.registryPath, workspace)),
  )
}
