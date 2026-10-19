import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from '../context.js'
import { registerAddRepoTool } from './addRepo.js'
import { registerCreateWorkspaceTool } from './createWorkspace.js'
import { registerListReposTool } from './listRepos.js'
import { registerListWorkspacesTool } from './listWorkspaces.js'
import { registerRemoveRepoTool } from './removeRepo.js'
import { registerRemoveWorkspaceTool } from './removeWorkspace.js'
import { registerWorkspaceStatusTool } from './workspaceStatus.js'

export function registerTools(server: McpServer, ctx: McpContext): void {
  registerListWorkspacesTool(server, ctx)
  registerCreateWorkspaceTool(server, ctx)
  registerAddRepoTool(server, ctx)
  registerRemoveRepoTool(server, ctx)
  registerRemoveWorkspaceTool(server, ctx)
  registerWorkspaceStatusTool(server, ctx)
  registerListReposTool(server, ctx)
}
