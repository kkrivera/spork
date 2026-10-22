import { findRepoUsages, listRepoAliases, removeRepo, removeRepoSource, SporkError, type RepoUsage } from '@spork/core'
import { NotInteractiveError, select, type PromptOption } from '@spork/prompts'
import type { TaskReporter } from '@spork/task-runner'
import type { Command } from 'commander'
import { runConcurrently } from '../../concurrentTasks.js'
import { confirmDestructive } from '../../confirmDestructive.js'
import { removeRepoSourceContext, workspaceContext, type AppContext } from '../../context.js'

export interface RemoveOptions {
  yes?: boolean
}

/** One entry per alias removed, in the order given — `reason` is set only when `removed` is false. */
export interface RemoveOutcome {
  alias: string
  removed: boolean
  reason?: string
}

export interface RunRemoveResult {
  outcomes: RemoveOutcome[]
}

/**
 * Offers a multi-select of every *globally* registered alias — used when
 * none were given. `repo remove` only ever operates on the global
 * registry (see `runRemove`'s own doc comment for why) — this never lists
 * a workspace's local aliases, even when run from inside one.
 */
async function pickAliases(ctx: AppContext): Promise<string[]> {
  const registered = await listRepoAliases(ctx.repoRegistryPath, ctx.reposRoot)
  if (registered.length === 0) {
    throw new SporkError('No repos registered globally.')
  }

  const options: PromptOption<string>[] = registered.map((repo) => ({ label: repo.alias, value: repo.alias, hint: repo.source }))

  let chosen: string[] | null
  try {
    chosen = await select({ message: 'Select repos to remove', options, mode: 'multi', minSelected: 1 })
  } catch (error) {
    if (error instanceof NotInteractiveError) {
      throw new SporkError('Multiple repos are registered — pass the alias(es) explicitly: spork repo remove <alias...>')
    }
    throw error
  }

  if (chosen === null) throw new SporkError('Cancelled.')
  return chosen
}

/**
 * Looks up each alias's real-worktree usages (`@spork/core`'s
 * `findRepoUsages` — already excludes `workspace init`-adopted folders,
 * which aren't backed by the cache at all) and, if any exist, warns which
 * workspaces/folders will also lose that worktree before anything is
 * removed. An alias that doesn't resolve to a registered global entry is
 * left out here — `runRemove`'s own task reports a specific, friendlier
 * error for that case instead of attempting removal.
 */
async function checkUsages(
  ctx: AppContext,
  registered: readonly { alias: string; source: string }[],
  names: readonly string[],
  options: RemoveOptions,
): Promise<Map<string, RepoUsage[]>> {
  const removeCtx = removeRepoSourceContext(ctx)

  const usagesByAlias = new Map<string, RepoUsage[]>()
  for (const name of names) {
    const entry = registered.find((repo) => repo.alias === name)
    if (entry) usagesByAlias.set(name, await findRepoUsages(removeCtx, entry.source))
  }

  const warningLines = [...usagesByAlias]
    .filter(([, usages]) => usages.length > 0)
    .map(([alias, usages]) => `  "${alias}" — ${usages.map((u) => `"${u.workspaceName}" (${u.folder})`).join(', ')}`)

  if (warningLines.length > 0) {
    await confirmDestructive(
      `This will also remove the repo from these workspace worktrees, deleting them from disk:\n${warningLines.join('\n')}`,
      options.yes,
    )
  }

  return usagesByAlias
}

/**
 * `repo remove` is deliberately **global-only** — a repo noun-group
 * command, unlike `workspace remove-repo`, which is the one place a
 * workspace's own *local* alias (and, for a real worktree, the worktree
 * itself) gets removed. Running this inside a workspace doesn't change
 * what it operates on; an alias that turns out to only be local to some
 * workspace gets a specific error pointing at `workspace remove-repo`
 * instead of a generic "not registered."
 *
 * `aliases` is empty when none were given on the command line — in that
 * case, offers a multi-select of every globally registered alias (see
 * `pickAliases`) instead of requiring the name(s) up front.
 *
 * `checkUsages` runs first and warns (gated behind `confirmDestructive`,
 * same as any other destructive batch here) if removing any alias would
 * also tear down a real worktree elsewhere — only once this is confirmed
 * does each alias's own task cascade through those workspaces'
 * `removeRepo` first, then remove the alias/cache itself. `@spork/core`'s
 * own in-use check is still the final backstop if a cascade step fails or
 * a race slips a new worktree in between the check and the removal — it
 * isn't bypassed, just pre-satisfied by the cascade.
 *
 * Not atomic, and not fail-fast: every alias is attempted regardless of a
 * sibling's failure, through `runConcurrently`'s live dashboard — each
 * removal only touches its own cache/alias entry (and, when cascading,
 * its own workspaces' manifests), all of which already protect themselves
 * with their own locking, so there's nothing here that actually requires
 * one-at-a-time ordering.
 */
export async function runRemove(ctx: AppContext, aliases: readonly string[], options: RemoveOptions): Promise<RunRemoveResult> {
  const names = aliases.length > 0 ? aliases : await pickAliases(ctx)
  const registered = await listRepoAliases(ctx.repoRegistryPath, ctx.reposRoot)
  const registeredAliases = new Set(registered.map((repo) => repo.alias))
  const usagesByAlias = await checkUsages(ctx, registered, names, options)
  const removeCtx = removeRepoSourceContext(ctx)

  const outcomes = await runConcurrently(
    names.map((alias) => ({
      name: alias,
      call: async (report: TaskReporter) => {
        if (!registeredAliases.has(alias)) {
          throw new SporkError(
            `"${alias}" is not a global repo alias. If it's local to a workspace, remove it with: spork workspace remove-repo <folder> --workspace <name>.`,
          )
        }

        for (const usage of usagesByAlias.get(alias) ?? []) {
          report.log(`removing from workspace "${usage.workspaceName}" (${usage.folder})...`)
          await removeRepo(workspaceContext(ctx), usage.workspaceDir, usage.folder)
        }

        report.log('removing...')
        return removeRepoSource(removeCtx, alias)
      },
    })),
  )

  return {
    outcomes: outcomes.map((outcome) => ({
      alias: outcome.name,
      removed: !outcome.cancelled && outcome.error === undefined,
      reason: outcome.cancelled ? 'cancelled' : outcome.errorMessage,
    })),
  }
}

export function registerRemoveCommand(program: Command, ctx: AppContext): void {
  program
    .command('remove [aliases...]')
    .description('Remove one or more globally-registered repo aliases and their caches (omit to pick from a list; also removes any real worktree using it, after confirming)')
    .option('-y, --yes', 'skip the confirmation prompt (only asked when a real worktree would also be removed)')
    .action(async (aliases: string[], options: RemoveOptions) => {
      const { outcomes } = await runRemove(ctx, aliases, options)

      const failures = outcomes.filter((outcome) => !outcome.removed)
      for (const outcome of outcomes) {
        if (outcome.removed) {
          console.log(ctx.ui.color.green(`Removed "${outcome.alias}"`))
        } else {
          console.log(ctx.ui.color.red(`Failed to remove "${outcome.alias}": ${outcome.reason}`))
        }
      }

      if (failures.length > 0) {
        throw new SporkError(`${failures.length} of ${outcomes.length} removals did not succeed: ${failures.map((f) => f.alias).join(', ')}`)
      }
    })
}
