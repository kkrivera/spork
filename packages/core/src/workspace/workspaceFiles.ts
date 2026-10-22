import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { renderAgentsBody, renderClaudeBody, type RepoAgentFiles, type RepoSummary } from './agentInstructions.js'
import { codeWorkspaceFilePath, writeCodeWorkspace } from './codeWorkspace.js'
import { manifestPath, type WorkspaceManifest } from './manifest.js'
import { stripBlock, upsertBlock } from './markerBlock.js'

export const AGENTS_FILENAME = 'AGENTS.md'
export const CLAUDE_FILENAME = 'CLAUDE.md'

export function inspectRepoAgentFiles(repoDir: string): RepoAgentFiles {
  return {
    claudeMd: existsSync(path.join(repoDir, 'CLAUDE.md')),
    agentsMd: existsSync(path.join(repoDir, 'AGENTS.md')),
    claudeSettings: existsSync(path.join(repoDir, '.claude', 'settings.json')),
    claudeAgents: existsSync(path.join(repoDir, '.claude', 'agents')),
  }
}

async function readIfExists(filePath: string): Promise<string | null> {
  return existsSync(filePath) ? readFile(filePath, 'utf8') : null
}

async function upsertFile(filePath: string, body: string): Promise<void> {
  await writeFile(filePath, upsertBlock(await readIfExists(filePath), body), 'utf8')
}

async function stripFile(filePath: string): Promise<void> {
  const existing = await readIfExists(filePath)
  if (existing === null) return
  const rest = stripBlock(existing)
  if (rest === null) {
    await rm(filePath, { force: true })
  } else if (rest !== existing) {
    await writeFile(filePath, rest, 'utf8')
  }
}

/** Writes spork's block into the workspace root's `AGENTS.md` and `CLAUDE.md` — see docs/plans/0004-workspace-agent-instructions.md. */
export async function writeAgentInstructions(workspaceDir: string, manifest: WorkspaceManifest): Promise<void> {
  const repos: RepoSummary[] = manifest.worktrees.map((entry) => ({
    entry,
    files: inspectRepoAgentFiles(path.join(workspaceDir, entry.folder)),
  }))
  await upsertFile(path.join(workspaceDir, AGENTS_FILENAME), renderAgentsBody(manifest, repos))
  await upsertFile(path.join(workspaceDir, CLAUDE_FILENAME), renderClaudeBody(repos))
}

/**
 * Regenerates every file derived from the manifest: the `.code-workspace`
 * file, and (unless the workspace opted out with `agentInstructions:
 * false`) the root `AGENTS.md`/`CLAUDE.md`. Every manifest-changing path in
 * `workspace.ts` calls this rather than writing any one of them directly,
 * so a new path can't update one and forget the others.
 */
export async function writeWorkspaceFiles(workspaceDir: string, manifest: WorkspaceManifest): Promise<void> {
  await writeCodeWorkspace(workspaceDir, manifest)
  if (manifest.agentInstructions === false) return
  await writeAgentInstructions(workspaceDir, manifest)
}

/**
 * Removes spork's own files from a workspace directory that isn't itself
 * being deleted (an `initialized` workspace's folder belongs to the user):
 * the manifest and `.code-workspace` file outright, and only spork's block
 * from `AGENTS.md`/`CLAUDE.md`, deleting either only if nothing else is left.
 */
export async function removeWorkspaceFiles(workspaceDir: string, manifest: WorkspaceManifest): Promise<void> {
  await rm(manifestPath(workspaceDir), { force: true })
  await rm(codeWorkspaceFilePath(workspaceDir, manifest.name), { force: true })
  await stripFile(path.join(workspaceDir, AGENTS_FILENAME))
  await stripFile(path.join(workspaceDir, CLAUDE_FILENAME))
}
