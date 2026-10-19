import { reconcileWorkspace, removeRepo, resolveWorkspaceDir, SporkError } from '@spork/core'
import { NotInteractiveError, select, type PromptOption } from '@spork/prompts'
import type { Command } from 'commander'
import { confirmDestructive } from '../../confirmDestructive.js'
import { workspaceContext, type AppContext } from '../../context.js'
import { pickWorkspaceName } from './pickWorkspace.js'

export interface RemoveRepoOptions {
  yes?: boolean
}

export interface RemoveRepoResult {
  workspace: string
  folder: string
}

/** Offers a single-select of the given workspace's worktree folders — used when `folder` was omitted. */
async function pickFolder(ctx: AppContext, dir: string, workspace: string): Promise<string> {
  const { manifest } = await reconcileWorkspace(workspaceContext(ctx), dir)
  if (manifest.worktrees.length === 0) {
    throw new SporkError(`Workspace "${workspace}" has no repos to remove.`)
  }

  const options: PromptOption<string>[] = manifest.worktrees.map((wt) => ({
    label: wt.folder,
    value: wt.folder,
    hint: wt.source,
  }))

  let chosen: string[] | null
  try {
    chosen = await select({ message: `Select a repo to remove from "${workspace}"`, options, mode: 'single' })
  } catch (error) {
    if (error instanceof NotInteractiveError) {
      throw new SporkError(
        `Workspace "${workspace}" has multiple repos — pass the folder explicitly: spork workspace remove-repo ${workspace} <folder>`,
      )
    }
    throw error
  }

  if (chosen === null) throw new SporkError('Cancelled.')
  return chosen[0] as string
}

/**
 * Both `workspace` and `folder` are optional — omitting either offers a
 * single-select picker (workspace from every registered one, folder from
 * the resolved workspace's own worktrees). Removing a worktree is
 * destructive (deletes it from disk), so it's always gated behind
 * `confirmDestructive`, including when both were given explicitly on the
 * command line. `--yes` skips that prompt for scripts/CI.
 */
export async function runRemoveRepo(
  ctx: AppContext,
  workspace: string | undefined,
  folder: string | undefined,
  options: RemoveRepoOptions,
): Promise<RemoveRepoResult> {
  const workspaceName =
    workspace ??
    (await pickWorkspaceName(
      ctx,
      'Select a workspace',
      'Multiple workspaces are registered — pass one explicitly: spork workspace remove-repo <workspace> <folder>',
    ))
  const dir = await resolveWorkspaceDir(ctx.registryPath, workspaceName)
  const folderName = folder ?? (await pickFolder(ctx, dir, workspaceName))

  await confirmDestructive(
    `Remove "${folderName}" from workspace "${workspaceName}"? This permanently deletes that worktree.`,
    options.yes,
  )

  await removeRepo(workspaceContext(ctx), dir, folderName)
  return { workspace: workspaceName, folder: folderName }
}

export function registerRemoveRepoCommand(program: Command, ctx: AppContext): void {
  program
    .command('remove-repo [workspace] [folder]')
    .description('Remove a repo (worktree) from a workspace (omit either to pick from a list)')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async (workspace: string | undefined, folder: string | undefined, options: RemoveRepoOptions) => {
      const result = await runRemoveRepo(ctx, workspace, folder, options)
      console.log(ctx.ui.color.green(`Removed "${result.folder}" from workspace "${result.workspace}"`))
    })
}
