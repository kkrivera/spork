import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getWorkspaceStatus, resolveWorkspaceDir } from '@spork/core'
import { z } from 'zod'
import { workspaceContext, type McpContext } from '../context.js'
import { jsonResult } from '../textResult.js'

export function registerWorkspaceStatusTool(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    'workspace_status',
    {
      description: 'Show local git status (branch, clean/dirty, changed file count) for every worktree in a workspace.',
      inputSchema: { workspace: z.string().describe('Workspace name') },
    },
    async ({ workspace }) => {
      const dir = await resolveWorkspaceDir(ctx.registryPath, workspace)
      return jsonResult(await getWorkspaceStatus(workspaceContext(ctx), dir))
    },
  )
}
