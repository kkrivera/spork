import { readManifest } from '../workspace/manifest.js'
import { listWorkspaces, type RegistryEntry } from './registry.js'

/** The last thing that happened to a workspace: a command used it, or (never used yet) it was created. */
export interface WorkspaceActivity {
  kind: 'used' | 'created'
  /** ISO 8601. */
  at: string
}

export interface RecentWorkspace extends RegistryEntry {
  /** null when the workspace was never used and its manifest can't be read. */
  lastActivity: WorkspaceActivity | null
}

async function lastActivity(workspace: RegistryEntry): Promise<WorkspaceActivity | null> {
  if (workspace.lastUsedAt) return { kind: 'used', at: workspace.lastUsedAt }
  try {
    const { createdAt } = await readManifest(workspace.dir)
    return createdAt ? { kind: 'created', at: createdAt } : null
  } catch {
    return null
  }
}

/**
 * `listWorkspaces`, most recently used first: by `lastUsedAt`, falling
 * back to the manifest's `createdAt` for a workspace no command has used
 * yet (so a new workspace starts near the top), with that time attached
 * as `lastActivity`. A workspace with neither sorts last; ties keep
 * registry order. Both times are ISO 8601 UTC strings, so they compare as
 * plain strings.
 */
export async function listWorkspacesByRecentUse(registryPath: string): Promise<RecentWorkspace[]> {
  const workspaces = await listWorkspaces(registryPath)
  const recent = await Promise.all(workspaces.map(async (workspace) => ({ ...workspace, lastActivity: await lastActivity(workspace) })))
  return recent.sort((a, b) => (b.lastActivity?.at ?? '').localeCompare(a.lastActivity?.at ?? ''))
}
