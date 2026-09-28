import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SporkError } from '../errors.js'
import { repoCacheExists } from '../repo/cache.js'

export interface RepoRegistryEntry {
  alias: string
  source: string
  addedAt: string
}

/** Filename of a workspace's *local* repo alias registry — sits next to its spork.workspace.json. */
export const LOCAL_REPO_REGISTRY_FILENAME = 'spork.repos.json'

export function localRepoRegistryPath(workspaceDir: string): string {
  return path.join(workspaceDir, LOCAL_REPO_REGISTRY_FILENAME)
}

interface RepoRegistryFile {
  repos: RepoRegistryEntry[]
}

async function readRegistryFile(registryPath: string): Promise<RepoRegistryFile> {
  if (!existsSync(registryPath)) return { repos: [] }
  const raw = await readFile(registryPath, 'utf8')
  return JSON.parse(raw) as RepoRegistryFile
}

async function writeRegistryFile(registryPath: string, file: RepoRegistryFile): Promise<void> {
  await mkdir(path.dirname(registryPath), { recursive: true })
  await writeFile(registryPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
}

export async function registerRepoAlias(registryPath: string, entry: RepoRegistryEntry): Promise<void> {
  const file = await readRegistryFile(registryPath)
  if (file.repos.some((repo) => repo.alias === entry.alias)) {
    throw new SporkError(`A repo alias named "${entry.alias}" is already registered.`)
  }
  file.repos.push(entry)
  await writeRegistryFile(registryPath, file)
}

export async function unregisterRepoAlias(registryPath: string, alias: string): Promise<void> {
  const file = await readRegistryFile(registryPath)
  file.repos = file.repos.filter((repo) => repo.alias !== alias)
  await writeRegistryFile(registryPath, file)
}

/**
 * Lists registered repo aliases. Like the workspace registry, this is an
 * index, not a source of truth: an entry whose cache no longer exists on
 * disk is dropped here and the drop is persisted.
 */
export async function listRepoAliases(registryPath: string, reposRoot: string): Promise<RepoRegistryEntry[]> {
  const file = await readRegistryFile(registryPath)
  const survivors = file.repos.filter((repo) => repoCacheExists(reposRoot, repo.source))

  if (survivors.length !== file.repos.length) {
    await writeRegistryFile(registryPath, { repos: survivors })
  }

  return survivors
}

/** Resolves a repo alias to its source, falling back to treating the input as a raw source verbatim. */
export async function resolveRepoAlias(registryPath: string, reposRoot: string, aliasOrSource: string): Promise<string> {
  const repos = await listRepoAliases(registryPath, reposRoot)
  const match = repos.find((repo) => repo.alias === aliasOrSource)
  return match ? match.source : aliasOrSource
}

/**
 * Resolves an alias against a workspace-local registry first, then the
 * global one, then falls back to the raw input — same precedent as
 * node_modules resolution (nearest wins, global is the fallback). Pass
 * `null` for `localRegistryPath` when there's no applicable local scope
 * (e.g. no enclosing workspace was found).
 */
export async function resolveScopedRepoAlias(
  reposRoot: string,
  localRegistryPath: string | null,
  globalRegistryPath: string,
  aliasOrSource: string,
): Promise<string> {
  if (localRegistryPath) {
    const local = await listRepoAliases(localRegistryPath, reposRoot)
    const localMatch = local.find((repo) => repo.alias === aliasOrSource)
    if (localMatch) return localMatch.source
  }

  const global = await listRepoAliases(globalRegistryPath, reposRoot)
  const globalMatch = global.find((repo) => repo.alias === aliasOrSource)
  return globalMatch ? globalMatch.source : aliasOrSource
}
