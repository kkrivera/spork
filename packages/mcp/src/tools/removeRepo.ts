import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { removeRepo, resolveWorkspaceDir } from '@spork/core'
import { z } from 'zod'
import { workspaceContext, type McpContext } from '../context.js'
import { textResult } from '../textResult.js'

export function registerRemoveRepoTool(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    'remove_repo',
    {
      description: 'Remove a repo (worktree) from a workspace. Deletes it from disk; the branch itself is never touched.',
      inputSchema: {
        workspace: z.string().describe('Workspace name'),
        folder: z.string().describe('Folder name of the repo to remove'),
      },
    },
    async ({ workspace, folder }) => {
      const dir = await resolveWorkspaceDir(ctx.registryPath, workspace)
      await removeRepo(workspaceContext(ctx), dir, folder)
      return textResult(`Removed "${folder}" from workspace "${workspace}".`)
    },
  )
}
