import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const MANIFEST_FILENAME = 'spork.workspace.json'

export interface WorktreeEntry {
  /** Folder name relative to the workspace root — the worktree checkout lives at `<workspaceDir>/<folder>`. */
  folder: string
  /** The repo source (remote URL or local path) this worktree was cloned from. */
  source: string
  /** The ref the user asked for (branch, tag, or sha). */
  requestedRef: string
  /** The spork-owned local branch actually checked out — see src/git/worktree.ts. */
  localBranch: string
  addedAt: string
}

export interface WorkspaceManifest {
  name: string
  createdAt: string
  worktrees: WorktreeEntry[]
}

export function manifestPath(workspaceDir: string): string {
  return path.join(workspaceDir, MANIFEST_FILENAME)
}

export function createManifest(name: string): WorkspaceManifest {
  return { name, createdAt: new Date().toISOString(), worktrees: [] }
}

export async function readManifest(workspaceDir: string): Promise<WorkspaceManifest> {
  const raw = await readFile(manifestPath(workspaceDir), 'utf8')
  return JSON.parse(raw) as WorkspaceManifest
}

export async function writeManifest(workspaceDir: string, manifest: WorkspaceManifest): Promise<void> {
  await writeFile(manifestPath(workspaceDir), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

/**
 * Walks up from `startDir` looking for a workspace (a directory with a
 * spork.workspace.json), the same way git walks up looking for `.git`.
 * Returns the first match, or `null` at the filesystem root. Used only by
 * the standalone `spork repo` commands to decide a context-sensitive
 * local-vs-global default — every `workspace` command already knows its
 * target by name and never needs this.
 */
export function findEnclosingWorkspaceDir(startDir: string): string | null {
  let dir = startDir

  while (true) {
    if (existsSync(manifestPath(dir))) return dir

    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}
