import { reconcileWorkspace, removeRepo, resolveWorkspaceDir, SporkError } from '@spork/core'
import { NotInteractiveError, select, type PromptOption } from '@spork/prompts'
import type { TaskReporter } from '@spork/task-runner'
import type { Command } from 'commander'
import { runConcurrently } from '../../concurrentTasks.js'
import { confirmDestructive } from '../../confirmDestructive.js'
import { workspaceContext, type AppContext } from '../../context.js'
import { pickWorkspaceName } from './pickWorkspace.js'

export interface RemoveRepoOptions {
  /** Which workspace to remove from — defaults to the cwd's enclosing workspace, or a picker (see `pickWorkspace.ts`). */
  workspace?: string
  yes?: boolean
}

/** One entry per folder removed, in the order given — `reason` is set only when `removed` is false. */
export interface RemoveRepoOutcome {
  folder: string
  removed: boolean
  reason?: string
}

export interface RunRemoveRepoResult {
  workspace: string
  outcomes: RemoveRepoOutcome[]
}

function describeFolders(folders: readonly string[]): string {
  return folders.length === 1 ? `"${folders[0]}"` : `${folders.length} repos (${folders.join(', ')})`
}

/** Offers a multi-select of the given workspace's worktree folders — used when no folders were given. */
async function pickFolders(ctx: AppContext, dir: string, workspace: string): Promise<string[]> {
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
    chosen = await select({ message: `Select repos to remove from "${workspace}"`, options, mode: 'multi', minSelected: 1 })
  } catch (error) {
    if (error instanceof NotInteractiveError) {
      throw new SporkError(`Workspace "${workspace}" has multiple repos — pass the folder(s) explicitly: spork workspace remove-repo <folder...> --workspace ${workspace}`)
    }
    throw error
  }

  if (chosen === null) throw new SporkError('Cancelled.')
  return chosen
}

/**
 * `folders` is empty when none were given on the command line — in that
 * case, offers a multi-select of the resolved workspace's own worktrees
 * (see `pickFolders`) instead of requiring the name(s) up front. Workspace
 * resolution follows the same rule every other optional-workspace command
 * uses (`pickWorkspace.ts`'s `pickWorkspaceName`): the cwd's enclosing
 * workspace if there is one, otherwise a single-select. Removing a
 * worktree is destructive (deletes it from disk), so it's always gated
 * behind a single, up-front `confirmDestructive` covering the whole batch
 * — including when every folder was given explicitly, not just when
 * picked. `--yes` skips that prompt for scripts/CI.
 *
 * The removals themselves run through `runConcurrently` (a live
 * dashboard, same as `remove`'s own batch removal) rather than a
 * sequential loop — each folder's removal only touches its own worktree
 * and the workspace manifest, which `@spork/core`'s `removeRepo` already
 * protects with its own locking, so there's nothing here that actually
 * requires one-at-a-time ordering. Best-effort, not fail-fast: every
 * folder is attempted regardless of a sibling's failure.
 */
export async function runRemoveRepo(ctx: AppContext, folders: readonly string[], options: RemoveRepoOptions): Promise<RunRemoveRepoResult> {
  const workspaceName =
    options.workspace ??
    (await pickWorkspaceName(
      ctx,
      'Select a workspace',
      'Multiple workspaces are registered — pass one explicitly: spork workspace remove-repo --workspace <name>',
    ))
  const dir = await resolveWorkspaceDir(ctx.registryPath, workspaceName)
  const names = folders.length > 0 ? folders : await pickFolders(ctx, dir, workspaceName)

  await confirmDestructive(
    `Remove ${describeFolders(names)} from workspace "${workspaceName}"? This permanently deletes ${names.length === 1 ? 'that worktree' : 'those worktrees'}.`,
    options.yes,
  )

  const outcomes = await runConcurrently(
    names.map((folder) => ({
      name: folder,
      call: (report: TaskReporter) => {
        report.log('removing...')
        return removeRepo(workspaceContext(ctx), dir, folder)
      },
    })),
  )

  return {
    workspace: workspaceName,
    outcomes: outcomes.map((outcome) => ({
      folder: outcome.name,
      removed: !outcome.cancelled && outcome.error === undefined,
      reason: outcome.cancelled ? 'cancelled' : outcome.errorMessage,
    })),
  }
}

export function registerRemoveRepoCommand(program: Command, ctx: AppContext): void {
  program
    .command('remove-repo [folders...]')
    .description('Remove one or more repos (worktrees) from a workspace (omit folders to pick from a list; omit --workspace to auto-detect/pick it)')
    .option('-w, --workspace <name>', 'workspace to remove from (default: auto-detected from cwd, or pick from a list)')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async (folders: string[], options: RemoveRepoOptions) => {
      const { workspace, outcomes } = await runRemoveRepo(ctx, folders, options)

      const failures = outcomes.filter((outcome) => !outcome.removed)
      for (const outcome of outcomes) {
        if (outcome.removed) {
          console.log(ctx.ui.color.green(`Removed "${outcome.folder}" from workspace "${workspace}"`))
        } else {
          console.log(ctx.ui.color.red(`Failed to remove "${outcome.folder}": ${outcome.reason}`))
        }
      }

      if (failures.length > 0) {
        throw new SporkError(`${failures.length} of ${outcomes.length} removals did not succeed: ${failures.map((f) => f.folder).join(', ')}`)
      }
    })
}
