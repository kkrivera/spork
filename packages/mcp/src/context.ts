import { REGISTRY_PATH, REPO_REGISTRY_PATH, REPOS_ROOT, type WorkspaceContext } from '@spork/core'

export interface McpContext {
  reposRoot: string
  registryPath: string
  repoRegistryPath: string
}

export function createMcpContext(): McpContext {
  return { reposRoot: REPOS_ROOT, registryPath: REGISTRY_PATH, repoRegistryPath: REPO_REGISTRY_PATH }
}

/** The subset of McpContext that @spork/core's workspace functions need. */
export function workspaceContext(ctx: McpContext): WorkspaceContext {
  return { reposRoot: ctx.reposRoot, repoRegistryPath: ctx.repoRegistryPath }
}
