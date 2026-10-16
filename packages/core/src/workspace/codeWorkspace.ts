import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WorkspaceManifest } from './manifest.js'

export interface CodeWorkspaceFolder {
  path: string
}

export interface CodeWorkspaceFile {
  folders: CodeWorkspaceFolder[]
}

/**
 * `name` is the workspace's own name, which may itself contain `/` (e.g. a
 * ticket-style name like `krisrivera/gw-2-fix`, used verbatim as every
 * worktree's branch name — see `workspace.ts`'s `addRepo`). Only its last
 * segment is used for the file's name — using it whole would try to nest
 * the `.code-workspace` file under an extra subdirectory of `workspaceDir`
 * that doesn't exist (`workspaceDir` is already `<parent>/<name>`).
 */
export function codeWorkspaceFilePath(workspaceDir: string, name: string): string {
  return path.join(workspaceDir, `${path.basename(name)}.code-workspace`)
}

export function buildCodeWorkspace(manifest: WorkspaceManifest): CodeWorkspaceFile {
  return {
    folders: manifest.worktrees.map((worktree) => ({ path: `./${worktree.folder}` })),
  }
}

/** Regenerates the workspace's `.code-workspace` file from its manifest, returning the file's path. */
export async function writeCodeWorkspace(workspaceDir: string, manifest: WorkspaceManifest): Promise<string> {
  const filePath = codeWorkspaceFilePath(workspaceDir, manifest.name)
  await writeFile(filePath, `${JSON.stringify(buildCodeWorkspace(manifest), null, 2)}\n`, 'utf8')
  return filePath
}
