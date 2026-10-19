import path from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createAndRegisterWorkspace } from '@spork/core'
import { z } from 'zod'
import { workspaceContext, type McpContext } from '../context.js'
import { textResult } from '../textResult.js'

/**
 * `dir` is required, with no cwd fallback — unlike the CLI's `--dir`
 * (which reasonably defaults to the terminal's cwd), the MCP server
 * process's own cwd isn't something the calling agent or user has any
 * reason to know or expect, so defaulting to it here could land a
 * workspace somewhere unexpected. The agent/user must say where.
 */
export function registerCreateWorkspaceTool(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    'create_workspace',
    {
      description:
        'Create a new, empty spork workspace: a folder with one git-worktree subfolder per repo added afterward with add_repo, all sharing one branch named after the workspace. Fails if the name is already registered.',
      inputSchema: {
        name: z
          .string()
          .describe('Workspace name — also becomes the shared branch name for every repo later added to it, and the folder name created under dir.'),
        dir: z.string().describe('Absolute parent directory to create the workspace in; it lands at `<dir>/<name>`.'),
      },
    },
    async ({ name, dir }) => {
      const resolvedDir = path.resolve(dir, name)
      const handle = await createAndRegisterWorkspace(workspaceContext(ctx), ctx.registryPath, { name, dir: resolvedDir })
      return textResult(`Created workspace "${handle.name}" at ${handle.dir}`)
    },
  )
}
