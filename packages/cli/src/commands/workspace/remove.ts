import { listWorkspaces, removeWorkspace, resolveWorkspaceDir, SporkError, unregisterWorkspace } from '@spork/core'
import type { TaskReporter } from '@spork/task-runner'
import type { Command } from 'commander'
import { runConcurrently } from '../../concurrentTasks.js'
import { confirmDestructive } from '../../confirmDestructive.js'
import { workspaceContext, type AppContext } from '../../context.js'
import { pickWorkspaceNames } from './pickWorkspace.js'

export interface RemoveOptions {
  keepFiles?: boolean
  yes?: boolean
}

/** One entry per workspace removed, in the order given — `reason` is set only when `removed` is false. */
export interface RemoveOutcome {
  name: string
  removed: boolean
  reason?: string
}

function describeTargets(names: readonly string[]): string {
  return names.length === 1 ? `workspace "${names[0]}"` : `${names.length} workspaces (${names.join(', ')})`
}

function describeConsequence(names: readonly string[], keepFiles: boolean | undefined): string {
  const pronoun = names.length === 1 ? 'its' : 'their'
  return keepFiles ? `This forgets ${names.length === 1 ? 'it' : 'them'} without touching ${pronoun} files.` : `This permanently deletes ${pronoun} worktrees and files.`
}

async function removeOne(ctx: AppContext, name: string, options: RemoveOptions): Promise<void> {
  const dir = await resolveWorkspaceDir(ctx.registryPath, name)
  await removeWorkspace(workspaceContext(ctx), dir, { keepFiles: options.keepFiles })

  const registered = await listWorkspaces(ctx.registryPath)
  const match = registered.find((entry) => entry.dir === dir)
  if (match) await unregisterWorkspace(ctx.registryPath, match.name)
}

/**
 * `workspaces` is empty when none were given on the command line — in that
 * case, offers a multi-select of every registered workspace (see
 * `pickWorkspace.ts`) instead of requiring the name(s) up front. Either way,
 * removal is destructive (deletes every worktree and, unless `--keep-files`,
 * the workspace directory itself), so it's always gated behind a single,
 * up-front `confirmDestructive` covering the whole batch — including when
 * every name was given explicitly, not just when picked interactively.
 * `--yes` skips that prompt for scripts/CI.
 *
 * The removals themselves run through `runConcurrently` (a live dashboard,
 * same as `create --repo a --repo b ...`/`repo scan`) rather than a plain
 * sequential loop — each workspace's removal only touches its own
 * directory and registry entry, and any shared repo cache is already
 * protected by its own lock (`removeRepo`'s `withRepoLock`), so there's
 * nothing here that actually requires one-at-a-time ordering. Best-effort,
 * not fail-fast: every workspace is attempted regardless of a sibling's
 * failure, same precedent `runCreateWithRepos`/`repo scan` already use —
 * `registerRemoveCommand` throws after printing every outcome, so a
 * partial failure still exits non-zero without silently dropping the
 * removals that did succeed.
 */
export async function runRemove(ctx: AppContext, workspaces: readonly string[], options: RemoveOptions): Promise<RemoveOutcome[]> {
  const names =
    workspaces.length > 0
      ? workspaces
      : await pickWorkspaceNames(
          ctx,
          'Select workspaces to remove',
          'Multiple workspaces are registered — pass one or more names explicitly: spork workspace remove <name...>',
        )

  await confirmDestructive(`Remove ${describeTargets(names)}? ${describeConsequence(names, options.keepFiles)}`, options.yes)

  const outcomes = await runConcurrently(
    names.map((name) => ({
      name,
      call: (report: TaskReporter) => {
        report.log('removing...')
        return removeOne(ctx, name, options)
      },
    })),
  )

  return outcomes.map((outcome) => ({
    name: outcome.name,
    removed: !outcome.cancelled && outcome.error === undefined,
    reason: outcome.cancelled ? 'cancelled' : outcome.errorMessage,
  }))
}

export function registerRemoveCommand(program: Command, ctx: AppContext): void {
  program
    .command('remove [workspaces...]')
    .description('Remove one or more workspaces (omit to pick from a list)')
    .option('--keep-files', 'forget the workspace without touching its files')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async (workspaces: string[], options: RemoveOptions) => {
      const outcomes = await runRemove(ctx, workspaces, options)

      const failures = outcomes.filter((outcome) => !outcome.removed)
      for (const outcome of outcomes) {
        if (outcome.removed) {
          console.log(ctx.ui.color.green(`Removed workspace "${outcome.name}"`))
        } else {
          console.log(ctx.ui.color.red(`Failed to remove "${outcome.name}": ${outcome.reason}`))
        }
      }

      if (failures.length > 0) {
        throw new SporkError(`${failures.length} of ${outcomes.length} removals did not succeed: ${failures.map((f) => f.name).join(', ')}`)
      }
    })
}
