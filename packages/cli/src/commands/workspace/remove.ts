import { listWorkspaces, removeWorkspace, resolveWorkspaceDir, unregisterWorkspace } from '@spork/core'
import type { Command } from 'commander'
import { confirmDestructive } from '../../confirmDestructive.js'
import { workspaceContext, type AppContext } from '../../context.js'
import { pickWorkspaceNames } from './pickWorkspace.js'

export interface RemoveOptions {
  keepFiles?: boolean
  yes?: boolean
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
 * the workspace directory itself), so it's always gated behind
 * `confirmDestructive` — including when every name was given explicitly,
 * not just when picked interactively. `--yes` skips that prompt for
 * scripts/CI.
 */
export async function runRemove(ctx: AppContext, workspaces: readonly string[], options: RemoveOptions): Promise<string[]> {
  const names =
    workspaces.length > 0
      ? workspaces
      : await pickWorkspaceNames(
          ctx,
          'Select workspaces to remove',
          'Multiple workspaces are registered — pass one or more names explicitly: spork workspace remove <name...>',
        )

  await confirmDestructive(`Remove ${describeTargets(names)}? ${describeConsequence(names, options.keepFiles)}`, options.yes)

  for (const name of names) {
    await removeOne(ctx, name, options)
  }
  return [...names]
}

export function registerRemoveCommand(program: Command, ctx: AppContext): void {
  program
    .command('remove [workspaces...]')
    .description('Remove one or more workspaces (omit to pick from a list)')
    .option('--keep-files', 'forget the workspace without touching its files')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async (workspaces: string[], options: RemoveOptions) => {
      const removed = await runRemove(ctx, workspaces, options)
      for (const name of removed) {
        console.log(ctx.ui.color.green(`Removed workspace "${name}"`))
      }
    })
}
