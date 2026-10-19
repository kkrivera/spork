import { addRepo, defaultAlias, resolveWorkspaceDir, SporkError, type AddRepoResult } from '@spork/core'
import { NotInteractiveError, select, type PromptOption } from '@spork/prompts'
import type { TaskReporter } from '@spork/task-runner'
import type { Command } from 'commander'
import { runConcurrently } from '../../concurrentTasks.js'
import { workspaceContext, type AppContext } from '../../context.js'
import { runList } from '../repo/list.js'
import { addReposToWorkspace, type AddRepoBatchFailure, type AddRepoBatchOutcome } from './addReposBatch.js'
import { pickWorkspaceName } from './pickWorkspace.js'

export interface AddRepoOptions {
  /** Which workspace to add to — defaults to the cwd's enclosing workspace, or a picker (see `pickWorkspace.ts`). */
  workspace?: string
  branch?: string
  as?: string
  /** Register the repo's alias globally instead of locally to this workspace (the default). */
  global?: boolean
}

export interface RunAddRepoResult {
  workspace: string
  result: AddRepoResult
}

/**
 * Runs the add through `runConcurrently` (a single-item list) so it gets a
 * live spinner/elapsed-time display while cloning/fetching, same as every
 * other wired command — but, unlike a batch command, re-throws the raw
 * error on failure rather than reporting it, to preserve this project's
 * existing "let it propagate to the top-level handler" contract for a
 * single operation. `workspace` is optional — when omitted, resolves to
 * the cwd's enclosing workspace or a single-select of every registered one
 * (see `pickWorkspace.ts`); the resolved name comes back in the result so
 * a caller that didn't know it up front (the CLI command below) can still
 * print it.
 */
export async function runAddRepo(
  ctx: AppContext,
  workspace: string | undefined,
  source: string,
  options: AddRepoOptions,
): Promise<RunAddRepoResult> {
  const workspaceName =
    workspace ??
    (await pickWorkspaceName(
      ctx,
      `Select a workspace to add "${source}" to`,
      'Multiple workspaces are registered — pass one explicitly: spork workspace add-repo --workspace <name> <source>',
    ))
  const dir = await resolveWorkspaceDir(ctx.registryPath, workspaceName)
  const [outcome] = await runConcurrently([
    {
      name: defaultAlias(source),
      call: (report: TaskReporter) => {
        report.log(`cloning/fetching ${source}...`)
        return addRepo(workspaceContext(ctx), dir, {
          source,
          ref: options.branch,
          folder: options.as,
          global: options.global,
        })
      },
    },
  ])

  if (outcome?.value === undefined) {
    throw outcome?.cancelled ? new SporkError('Cancelled.') : outcome?.error
  }
  return { workspace: workspaceName, result: outcome.value }
}

/** Prints an AddRepoResult the same way regardless of whether it came from `add-repo` or `create --repo`. */
export function printAddRepoResult(ctx: AppContext, workspace: string, result: AddRepoResult): void {
  const { entry } = result
  console.log(
    ctx.ui.color.green(
      `Added "${entry.folder}" (${entry.localBranch}) to workspace "${workspace}" (alias: ${result.aliasScope})`,
    ),
  )

  if (result.reusedExistingBranch) {
    console.log(ctx.ui.color.dim(`Reused existing branch "${entry.localBranch}" for "${entry.folder}".`))
  }

  if (result.submodulesInitialized) {
    console.log(`Initialized submodules in "${entry.folder}"`)
  } else if (result.submoduleWarning) {
    console.log(
      ctx.ui.color.yellow(
        `Warning: "${entry.folder}" has submodules but initializing them failed: ${result.submoduleWarning}`,
      ),
    )
  }
}

/** Offers a multi-select of every registered repo (the same merged local+global view `repo list` shows). */
async function pickRegisteredSources(ctx: AppContext): Promise<string[]> {
  const candidates = await runList(ctx)
  if (candidates.length === 0) {
    throw new SporkError('No repos registered yet. Register one with: spork repo add <source>, or spork repo scan <dir>.')
  }

  const options: PromptOption<string>[] = candidates.map((repo) => ({
    label: repo.alias,
    value: repo.source,
    hint: `${repo.source} (${repo.scope})`,
  }))

  let chosen: string[] | null
  try {
    chosen = await select({ message: 'Select repos to add', options, mode: 'multi', minSelected: 1 })
  } catch (error) {
    if (error instanceof NotInteractiveError) {
      throw new SporkError('Multiple repos are registered — pass a source explicitly: spork workspace add-repo <source>')
    }
    throw error
  }

  if (chosen === null) throw new SporkError('Cancelled.')
  return chosen
}

export interface RunAddRepoFromRegistryResult {
  workspace: string
  outcomes: AddRepoBatchOutcome[]
}

/**
 * `add-repo`'s no-source flow: resolve the workspace (same as `runAddRepo`
 * — the cwd's enclosing workspace, or a single-select), then offer a
 * multi-select of every already-registered repo instead of requiring a raw
 * source string. Adding an unregistered, never-cloned repo is still
 * possible — just pass it as an explicit `<source>` — but the common case
 * is adding one already scanned/registered elsewhere, and retyping its
 * full source every time is the friction this removes.
 */
export async function runAddRepoFromRegistry(
  ctx: AppContext,
  workspace: string | undefined,
  options: Pick<AddRepoOptions, 'global'>,
): Promise<RunAddRepoFromRegistryResult> {
  const workspaceName =
    workspace ??
    (await pickWorkspaceName(
      ctx,
      'Select a workspace',
      'Multiple workspaces are registered — pass one explicitly: spork workspace add-repo --workspace <name>',
    ))
  const dir = await resolveWorkspaceDir(ctx.registryPath, workspaceName)
  const sources = await pickRegisteredSources(ctx)
  const outcomes = await addReposToWorkspace(ctx, dir, sources, { global: options.global })

  return { workspace: workspaceName, outcomes }
}

/** Prints every outcome from `runAddRepoFromRegistry`, then throws (after printing all of them) if any failed. */
function printAddRepoBatchOutcomes(ctx: AppContext, workspace: string, outcomes: AddRepoBatchOutcome[]): void {
  const failures: AddRepoBatchFailure[] = []
  for (const outcome of outcomes) {
    if (outcome.result) {
      printAddRepoResult(ctx, workspace, outcome.result)
    } else if (outcome.failure) {
      failures.push(outcome.failure)
      console.log(ctx.ui.color.red(`Failed to add "${outcome.source}": ${outcome.failure.reason}`))
    }
  }

  if (failures.length > 0) {
    throw new SporkError(`${failures.length} of ${outcomes.length} repo adds did not succeed: ${failures.map((f) => f.source).join(', ')}`)
  }
}

export function registerAddRepoCommand(program: Command, ctx: AppContext): void {
  program
    .command('add-repo [source]')
    .description('Add a repo to a workspace (omit source to pick from registered repos; omit --workspace to auto-detect/pick it)')
    .option('-w, --workspace <name>', 'workspace to add to (default: auto-detected from cwd, or pick from a list)')
    .option('--branch <ref>', "branch/tag/sha to check out (default: the repo's default branch; requires <source>)")
    .option('--as <folder>', 'folder name to use (default: derived from the repo name; requires <source>)')
    .option('--global', "register the repo's alias globally instead of locally to this workspace")
    .action(async (source: string | undefined, options: AddRepoOptions) => {
      if (source === undefined) {
        if (options.branch !== undefined || options.as !== undefined) {
          throw new SporkError('--branch/--as require an explicit <source> — they cannot apply to a multi-repo pick.')
        }
        const { workspace, outcomes } = await runAddRepoFromRegistry(ctx, options.workspace, options)
        printAddRepoBatchOutcomes(ctx, workspace, outcomes)
        return
      }

      const { workspace, result } = await runAddRepo(ctx, options.workspace, source, options)
      printAddRepoResult(ctx, workspace, result)
    })
}
