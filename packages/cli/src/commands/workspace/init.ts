import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  adoptRepoIntoWorkspace,
  findGitRepoDirs,
  initAndRegisterWorkspace,
  manifestPath,
  SporkError,
  type AdoptedEntry,
  type WorkspaceHandle,
} from '@spork/core'
import { NotInteractiveError, select, type PromptOption } from '@spork/prompts'
import type { TaskReporter } from '@spork/task-runner'
import type { Command } from 'commander'
import { runConcurrently } from '../../concurrentTasks.js'
import { workspaceContext, type AppContext } from '../../context.js'

export interface AdoptBatchFailure {
  folder: string
  reason: string
  cancelled: boolean
}

/** One entry per folder, in the order given — exactly one of `result`/`failure` is set. */
export interface AdoptBatchOutcome {
  folder: string
  result?: AdoptedEntry
  failure?: AdoptBatchFailure
}

export interface InitResult {
  handle: WorkspaceHandle
  outcomes: AdoptBatchOutcome[]
}

/**
 * Picks which of the git folders `findGitRepoDirs` found in `dir` join the
 * new workspace. With a real terminal, a multi-select (`minSelected: 1` —
 * `init` must adopt at least one folder, same reasoning `add-repo`'s own
 * registry picker already uses). Without one (CI/a script),
 * `NotInteractiveError` is caught and every found folder is used instead —
 * mirroring `repo scan`'s own "adopt everything" bulk philosophy for a
 * non-interactive context, unlike `create --repo`'s "nothing picked = empty
 * workspace" fallback: there's no useful empty `init`.
 */
async function resolveFolders(dir: string, found: readonly string[]): Promise<string[]> {
  const folderNames = found.map((repoDir) => path.basename(repoDir))
  if (folderNames.length === 0) {
    throw new SporkError(`No git repos found directly under ${dir}.`)
  }

  const options: PromptOption<string>[] = folderNames.map((name) => ({ label: name, value: name }))
  let chosen: string[] | null
  try {
    chosen = await select({ message: 'Select folders to include in this workspace', options, mode: 'multi', minSelected: 1 })
  } catch (error) {
    if (error instanceof NotInteractiveError) return folderNames
    throw error
  }

  if (chosen === null) throw new SporkError('Cancelled.')
  return chosen
}

/**
 * Turns `cwd` into a workspace in place: finds git repos one level deep
 * (`@spork/core`'s `findGitRepoDirs`, same scan `repo scan` uses), lets the
 * user choose which join (`resolveFolders`), then creates the workspace and
 * adopts each chosen folder exactly as it already sits on disk — never a
 * worktree, never a branch change (`@spork/core`'s
 * `initWorkspace`/`adoptRepoIntoWorkspace`). Every chosen folder is still
 * attempted even if a sibling fails, same not-atomic/not-fail-fast contract
 * as `create --repo`/`add-repo`'s batch add — `registerInitCommand` prints
 * every outcome and throws afterward if any failed.
 */
export async function runInit(ctx: AppContext, name: string): Promise<InitResult> {
  const dir = process.cwd()
  if (existsSync(manifestPath(dir))) {
    throw new SporkError(`"${dir}" is already a spork workspace.`)
  }

  const found = await findGitRepoDirs(dir)
  const folders = await resolveFolders(dir, found)

  const handle = await initAndRegisterWorkspace(workspaceContext(ctx), ctx.registryPath, { name, dir })

  const outcomes = await runConcurrently(
    folders.map((folder) => ({
      name: folder,
      call: (report: TaskReporter) => {
        report.log(`adopting ${folder}...`)
        return adoptRepoIntoWorkspace(workspaceContext(ctx), dir, folder)
      },
    })),
  )

  return {
    handle,
    outcomes: outcomes.map((outcome, index) => {
      const folder = folders[index] as string
      if (outcome.value) return { folder, result: outcome.value }
      return {
        folder,
        failure: {
          folder,
          cancelled: outcome.cancelled,
          reason: outcome.cancelled ? 'cancelled' : (outcome.errorMessage ?? 'failed'),
        },
      }
    }),
  }
}

export function registerInitCommand(program: Command, ctx: AppContext): void {
  program
    .command('init <name>')
    .description(
      'Turn the current directory into a workspace in place, adopting its existing git folders (no worktrees, no branch changes)',
    )
    .action(async (name: string) => {
      const { handle, outcomes } = await runInit(ctx, name)
      console.log(ctx.ui.color.green(`Initialized workspace "${handle.name}" at ${handle.dir}`))

      const failures: AdoptBatchFailure[] = []
      for (const outcome of outcomes) {
        if (outcome.result) {
          console.log(ctx.ui.color.green(`Adopted "${outcome.result.folder}" (source: ${outcome.result.source})`))
        } else if (outcome.failure) {
          failures.push(outcome.failure)
          console.log(ctx.ui.color.red(`Failed to adopt "${outcome.folder}": ${outcome.failure.reason}`))
        }
      }

      if (failures.length > 0) {
        throw new SporkError(
          `${failures.length} of ${outcomes.length} folders failed to adopt: ${failures.map((f) => f.folder).join(', ')}`,
        )
      }
    })
}
