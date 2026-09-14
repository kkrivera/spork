import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SporkError } from '../errors.js'
import { manifestPath } from '../workspace/manifest.js'

export interface RegistryEntry {
  name: string
  /** Absolute path to the workspace's directory (holds its manifest and .code-workspace file). */
  dir: string
}

interface RegistryFile {
  workspaces: RegistryEntry[]
}

async function readRegistryFile(registryPath: string): Promise<RegistryFile> {
  if (!existsSync(registryPath)) return { workspaces: [] }
  const raw = await readFile(registryPath, 'utf8')
  return JSON.parse(raw) as RegistryFile
}

async function writeRegistryFile(registryPath: string, file: RegistryFile): Promise<void> {
  await mkdir(path.dirname(registryPath), { recursive: true })
  await writeFile(registryPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
}

export async function registerWorkspace(registryPath: string, entry: RegistryEntry): Promise<void> {
  const file = await readRegistryFile(registryPath)
  if (file.workspaces.some((workspace) => workspace.name === entry.name)) {
    throw new SporkError(`A workspace named "${entry.name}" is already registered.`)
  }
  file.workspaces.push(entry)
  await writeRegistryFile(registryPath, file)
}

export async function unregisterWorkspace(registryPath: string, name: string): Promise<void> {
  const file = await readRegistryFile(registryPath)
  file.workspaces = file.workspaces.filter((workspace) => workspace.name !== name)
  await writeRegistryFile(registryPath, file)
}

/**
 * Lists registered workspaces. The registry is an index, not a source of
 * truth: any entry whose manifest no longer exists on disk (the workspace
 * directory was deleted by hand) is dropped here and the drop is persisted,
 * rather than trusting stale state — see
 * docs/plans/0001-worktree-workspace-architecture.md.
 */
export async function listWorkspaces(registryPath: string): Promise<RegistryEntry[]> {
  const file = await readRegistryFile(registryPath)
  const survivors = file.workspaces.filter((workspace) => existsSync(manifestPath(workspace.dir)))

  if (survivors.length !== file.workspaces.length) {
    await writeRegistryFile(registryPath, { workspaces: survivors })
  }

  return survivors
}

/** Resolves a workspace name via the registry, falling back to treating the input as a raw workspace directory. */
export async function resolveWorkspaceDir(registryPath: string, nameOrPath: string): Promise<string> {
  const workspaces = await listWorkspaces(registryPath)
  const match = workspaces.find((workspace) => workspace.name === nameOrPath)
  if (match) return match.dir

  if (existsSync(manifestPath(nameOrPath))) return nameOrPath

  throw new SporkError(
    `No workspace named "${nameOrPath}" is registered, and "${nameOrPath}" is not a spork workspace directory.`,
  )
}
