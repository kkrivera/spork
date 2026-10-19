import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { removeAndUnregisterWorkspace, resolveWorkspaceDir } from '@spork/core'
import { z } from 'zod'
import { workspaceContext, type McpContext } from '../context.js'
import { textResult } from '../textResult.js'

/**
 * No confirmation prompt — there's no interactive terminal to prompt on the
 * other end of an MCP tool call. Calling this tool at all is the caller's
 * explicit confirmation, the same way a CLI script passes `--yes`.
 */
export function registerRemoveWorkspaceTool(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    'remove_workspace',
    {
      description: 'Permanently remove a workspace: every worktree, and (unless keepFiles) the workspace directory itself. Branches are never deleted.',
      inputSchema: {
        workspace: z.string().describe('Workspace name'),
        keepFiles: z.boolean().optional().describe('Only forget the workspace in the registry, without touching its files'),
      },
    },
    async ({ workspace, keepFiles }) => {
      const dir = await resolveWorkspaceDir(ctx.registryPath, workspace)
      await removeAndUnregisterWorkspace(workspaceContext(ctx), ctx.registryPath, dir, { keepFiles })
      return textResult(`Removed workspace "${workspace}".`)
    },
  )
}
