import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WorkspaceManifest } from './manifest.js'

export interface CodeWorkspaceFolder {
  path: string
}

export interface CodeWorkspaceFile {
  folders: CodeWorkspaceFolder[]
}

export function codeWorkspaceFilePath(workspaceDir: string, name: string): string {
  return path.join(workspaceDir, `${name}.code-workspace`)
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
