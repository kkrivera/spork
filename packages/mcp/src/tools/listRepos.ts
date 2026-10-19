import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { listRepoAliases, localRepoRegistryPath, resolveWorkspaceDir, type RepoRegistryEntry } from '@spork/core'
import { z } from 'zod'
import type { McpContext } from '../context.js'
import { jsonResult } from '../textResult.js'

interface ScopedRepoEntry extends RepoRegistryEntry {
  scope: 'local' | 'global'
}

/**
 * `workspace` is explicit rather than cwd-detected (unlike `spork repo
 * list`'s local-if-cwd-is-inside-a-workspace default) — the MCP server
 * process's own cwd isn't a meaningful stand-in for "which workspace is
 * the caller asking about," so there's nothing to auto-detect from here.
 */
export function registerListReposTool(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    'list_repos',
    {
      description: "List registered repo aliases: every global one, plus a workspace's own local aliases if `workspace` is given.",
      inputSchema: {
        workspace: z.string().optional().describe("Include this workspace's local aliases alongside the global ones"),
      },
    },
    async ({ workspace }) => {
      const entries: ScopedRepoEntry[] = []

      if (workspace) {
        const dir = await resolveWorkspaceDir(ctx.registryPath, workspace)
        const local = await listRepoAliases(localRepoRegistryPath(dir), ctx.reposRoot)
        entries.push(...local.map((repo) => ({ ...repo, scope: 'local' as const })))
      }

      const global = await listRepoAliases(ctx.repoRegistryPath, ctx.reposRoot)
      entries.push(...global.map((repo) => ({ ...repo, scope: 'global' as const })))

      return jsonResult(entries)
    },
  )
}
