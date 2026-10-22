import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const MANIFEST_FILENAME = 'spork.workspace.json'

export interface WorktreeEntry {
  /** Absent on any manifest written before `kind` existed — treat as `'worktree'`. */
  kind?: 'worktree'
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

/**
 * A folder `workspace init` adopted exactly as it already sat on disk —
 * never a git worktree of spork's shared cache, so no `requestedRef`/
 * `localBranch`: spork never asked git to check out anything here, and
 * never will (see `workspace init`'s own doc comment for why).
 */
export interface AdoptedEntry {
  kind: 'adopted'
  folder: string
  /** The repo source (remote URL or local path) this folder was adopted *from* — spork's cache clone, not this folder itself. */
  source: string
  addedAt: string
}

export type ManifestEntry = WorktreeEntry | AdoptedEntry

export interface WorkspaceManifest {
  name: string
  createdAt: string
  /** Absent on any manifest written before `origin` existed — treat as `'created'`. */
  origin?: 'created' | 'initialized'
  /**
   * `false` opts this workspace out of the generated root `AGENTS.md`/
   * `CLAUDE.md` (see docs/plans/0004-workspace-agent-instructions.md).
   * Absent means on, including on every manifest written before this existed.
   */
  agentInstructions?: boolean
  worktrees: ManifestEntry[]
}

export function manifestPath(workspaceDir: string): string {
  return path.join(workspaceDir, MANIFEST_FILENAME)
}

export function createManifest(
  name: string,
  origin: WorkspaceManifest['origin'] = 'created',
  agentInstructions = true,
): WorkspaceManifest {
  return { name, createdAt: new Date().toISOString(), origin, ...(agentInstructions ? {} : { agentInstructions: false }), worktrees: [] }
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
