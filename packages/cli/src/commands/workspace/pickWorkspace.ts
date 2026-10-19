import { realpath } from 'node:fs/promises'
import { findEnclosingWorkspaceDir, listWorkspaces, SporkError, type RegistryEntry } from '@spork/core'
import { NotInteractiveError, select, type PromptOption } from '@spork/prompts'
import type { AppContext } from '../../context.js'

async function pickableWorkspaces(ctx: AppContext): Promise<PromptOption<string>[]> {
  const workspaces = await listWorkspaces(ctx.registryPath)
  if (workspaces.length === 0) {
    throw new SporkError('No workspaces yet. Create one with: spork workspace create <name>')
  }
  return workspaces.map((workspace) => ({ label: workspace.name, value: workspace.name, hint: workspace.dir }))
}

/**
 * `findEnclosingWorkspaceDir` resolves from `process.cwd()`, which Node
 * always returns as the canonical, symlink-resolved path — but a
 * registered workspace's `dir` is whatever was passed to `--dir` at
 * creation time, verbatim, which may not be (e.g. macOS's `/tmp` being a
 * symlink to `/private/tmp`). A plain string comparison between the two
 * would silently never match on a system like that, so the registry side
 * is resolved before comparing. `listWorkspaces` only ever returns entries
 * it has already confirmed still exist on disk, so `realpath` here is
 * never pointed at something missing — but a race (deleted between that
 * check and this one) falls back to the raw string rather than throwing.
 */
async function matchesEnclosingDir(workspace: RegistryEntry, enclosingDir: string): Promise<boolean> {
  if (workspace.dir === enclosingDir) return true
  try {
    return (await realpath(workspace.dir)) === enclosingDir
  } catch {
    return false
  }
}

/**
 * Resolves a single workspace name for a command whose workspace argument
 * was omitted. First checks whether `cwd` is already inside a registered
 * workspace (`@spork/core`'s `findEnclosingWorkspaceDir`, walking up like
 * git's `.git` walk — the same convention `repoScope.ts` already uses for
 * `spork repo`'s local/global default) and, if so, uses it directly with
 * no prompt at all — there's nothing ambiguous to ask about. Otherwise
 * offers a single-select of every registered workspace. `select` throws
 * `NotInteractiveError` when it can't prompt (no TTY); there's no sensible
 * default to fall back to, so that becomes a clear `SporkError` naming the
 * explicit-argument form instead. A real cancel (Esc/Ctrl+C) becomes
 * `SporkError`'s usual `'Cancelled.'`, same as every other cancelled-prompt
 * path in this CLI.
 */
export async function pickWorkspaceName(
  ctx: AppContext,
  message: string,
  usageHint: string,
  cwd: string = process.cwd(),
): Promise<string> {
  const enclosingDir = findEnclosingWorkspaceDir(cwd)
  if (enclosingDir) {
    const workspaces = await listWorkspaces(ctx.registryPath)
    for (const workspace of workspaces) {
      if (await matchesEnclosingDir(workspace, enclosingDir)) return workspace.name
    }
  }

  const options = await pickableWorkspaces(ctx)

  let chosen: string[] | null
  try {
    chosen = await select({ message, options, mode: 'single' })
  } catch (error) {
    if (error instanceof NotInteractiveError) throw new SporkError(usageHint)
    throw error
  }

  if (chosen === null) throw new SporkError('Cancelled.')
  return chosen[0] as string
}

/**
 * Same as `pickWorkspaceName`, but a multi-select — for a command that can
 * act on several workspaces at once. Deliberately no cwd auto-detect:
 * picking several is the point, so it always offers the full list rather
 * than collapsing to "just the one you're sitting in".
 */
export async function pickWorkspaceNames(ctx: AppContext, message: string, usageHint: string): Promise<string[]> {
  const options = await pickableWorkspaces(ctx)

  let chosen: string[] | null
  try {
    chosen = await select({ message, options, mode: 'multi', minSelected: 1 })
  } catch (error) {
    if (error instanceof NotInteractiveError) throw new SporkError(usageHint)
    throw error
  }

  if (chosen === null) throw new SporkError('Cancelled.')
  return chosen
}
