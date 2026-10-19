import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { addRepo, resolveWorkspaceDir } from '@spork/core'
import { z } from 'zod'
import { workspaceContext, type McpContext } from '../context.js'
import { textResult } from '../textResult.js'

export function registerAddRepoTool(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    'add_repo',
    {
      description: "Add a repo to a workspace as an isolated git worktree, checked out on the workspace's shared branch.",
      inputSchema: {
        workspace: z.string().describe('Workspace name'),
        source: z.string().describe('Repo source: a clone URL, a local path, or an already-registered alias'),
        ref: z.string().optional().describe("Branch/tag/sha to check out if the workspace's branch doesn't already exist in this repo (default: the repo's default branch)"),
        folder: z.string().optional().describe('Folder name to use under the workspace (default: derived from the repo name)'),
        global: z.boolean().optional().describe("Register the repo's alias globally instead of locally to this workspace"),
      },
    },
    async ({ workspace, source, ref, folder, global }) => {
      const dir = await resolveWorkspaceDir(ctx.registryPath, workspace)
      const result = await addRepo(workspaceContext(ctx), dir, { source, ref, folder, global })

      const lines = [`Added "${result.entry.folder}" (${result.entry.localBranch}) to workspace "${workspace}" (alias: ${result.aliasScope})`]
      if (result.reusedExistingBranch) lines.push(`Reused the existing branch "${result.entry.localBranch}".`)
      if (result.submodulesInitialized) {
        lines.push(`Initialized submodules in "${result.entry.folder}".`)
      } else if (result.submoduleWarning) {
        lines.push(`Warning: "${result.entry.folder}" has submodules but initializing them failed: ${result.submoduleWarning}`)
      }
      return textResult(lines.join('\n'))
    },
  )
}
