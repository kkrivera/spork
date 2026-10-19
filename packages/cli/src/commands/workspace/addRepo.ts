import { addRepo, defaultAlias, resolveWorkspaceDir, SporkError, type AddRepoResult } from '@spork/core'
import type { TaskReporter } from '@spork/task-runner'
import type { Command } from 'commander'
import { runConcurrently } from '../../concurrentTasks.js'
import { workspaceContext, type AppContext } from '../../context.js'
import { pickWorkspaceName } from './pickWorkspace.js'

export interface AddRepoOptions {
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
 * single operation. `workspace` is optional — when omitted, offers a
 * single-select of every registered workspace (see `pickWorkspace.ts`); the
 * resolved name comes back in the result so a caller that didn't know it
 * up front (the CLI command below) can still print it.
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
      'Multiple workspaces are registered — pass one explicitly: spork workspace add-repo <workspace> <source>',
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

/**
 * `add-repo` takes two positionals, `[workspace] [source]`, but only
 * `source` stays truly required — `workspace` is the one becoming optional.
 * Commander fills optional positionals left-to-right regardless of which
 * one a caller means to omit, so a lone argument would otherwise land in
 * `workspace` and leave `source` (the one that can never be prompted away)
 * missing. This resolves that: two arguments keep today's exact meaning
 * (workspace, then source); a lone argument is always the source, with
 * `workspace` left undefined for `runAddRepo` to prompt for.
 */
function resolveAddRepoArgs(first: string | undefined, second: string | undefined): { workspace?: string; source: string } {
  if (second !== undefined) return { workspace: first, source: second }
  if (first === undefined) {
    throw new SporkError('Missing required argument: source. Usage: spork workspace add-repo [workspace] <source>')
  }
  return { source: first }
}

export function registerAddRepoCommand(program: Command, ctx: AppContext): void {
  program
    .command('add-repo [workspace] [source]')
    .description('Add a repo to a workspace as an isolated git worktree (omit workspace to pick from a list)')
    .option('--branch <ref>', "branch/tag/sha to check out (default: the repo's default branch)")
    .option('--as <folder>', 'folder name to use (default: derived from the repo name)')
    .option('--global', "register the repo's alias globally instead of locally to this workspace")
    .action(async (first: string | undefined, second: string | undefined, options: AddRepoOptions) => {
      const { workspace, source } = resolveAddRepoArgs(first, second)
      const { workspace: resolvedWorkspace, result } = await runAddRepo(ctx, workspace, source, options)
      printAddRepoResult(ctx, resolvedWorkspace, result)
    })
}
