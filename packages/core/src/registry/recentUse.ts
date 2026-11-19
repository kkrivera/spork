import { readManifest } from '../workspace/manifest.js'
import { listWorkspaces, type RegistryEntry } from './registry.js'

/** When the workspace was created, or '' when its manifest can't be read (sorts last). */
async function createdAt(dir: string): Promise<string> {
  try {
    return (await readManifest(dir)).createdAt ?? ''
  } catch {
    return ''
  }
}

/**
 * `listWorkspaces`, most recently used first: by `lastUsedAt`, falling
 * back to the manifest's `createdAt` for a workspace no command has used
 * yet (so a new workspace starts near the top). Workspaces with the same
 * time keep their registry order. Both are ISO 8601 UTC strings, so they
 * compare as plain strings.
 */
export async function listWorkspacesByRecentUse(registryPath: string): Promise<RegistryEntry[]> {
  const workspaces = await listWorkspaces(registryPath)
  const keyed = await Promise.all(
    workspaces.map(async (workspace) => ({ workspace, at: workspace.lastUsedAt ?? (await createdAt(workspace.dir)) })),
  )
  return keyed.sort((a, b) => b.at.localeCompare(a.at)).map(({ workspace }) => workspace)
}
