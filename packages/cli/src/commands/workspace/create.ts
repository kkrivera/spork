import path from 'node:path'
import {
  addRepo,
  createWorkspace,
  defaultAlias,
  listWorkspaces,
  registerWorkspace,
  SporkError,
  type AddRepoResult,
  type WorkspaceHandle,
} from '@spork/core'
import type { Command } from 'commander'
import { runConcurrently } from '../../concurrentTasks.js'
import { workspaceContext, type AppContext } from '../../context.js'
import { printAddRepoResult } from './addRepo.js'

export interface CreateOptions {
  dir?: string
  repo?: string[]
  /** Register each --repo's alias globally instead of locally to the new workspace (the default). */
  global?: boolean
}

function collectRepo(value: string, previous: string[]): string[] {
  return [...previous, value]
}

export async function runCreate(ctx: AppContext, name: string, options: CreateOptions): Promise<WorkspaceHandle> {
  const existing = await listWorkspaces(ctx.registryPath)
  if (existing.some((workspace) => workspace.name === name)) {
    throw new SporkError(`A workspace named "${name}" is already registered.`)
  }

  const dir = options.dir ? path.resolve(options.dir) : path.resolve(process.cwd(), name)
  const handle = await createWorkspace(workspaceContext(ctx), { name, dir })
  await registerWorkspace(ctx.registryPath, { name, dir })

  return handle
}

export interface CreateRepoFailure {
  source: string
  reason: string
  cancelled: boolean
}

/** One entry per `--repo`, in the order given — exactly one of `result`/`failure` is set. */
export interface CreateRepoOutcome {
  source: string
  result?: AddRepoResult
  failure?: CreateRepoFailure
}

export interface CreateWithReposResult {
  handle: WorkspaceHandle
  repoOutcomes: CreateRepoOutcome[]
}

/**
 * Creates the workspace, then adds every `--repo` concurrently (through
 * `runConcurrently`'s live dashboard), calling `addRepo` directly rather
 * than going through the standalone `add-repo` command's `runAddRepo` —
 * that wraps a single item in its own dashboard, which would mean nesting
 * one per repo here instead of one dashboard for the whole batch.
 *
 * Not atomic, and no longer fail-fast: every `--repo` runs regardless of a
 * sibling's failure (same "best effort over a batch" precedent `repo scan`
 * already uses), so the already-created workspace ends up with whatever
 * repos succeeded. Unlike `repo scan`'s best-effort bulk-adopt, a failed or
 * cancelled `--repo` here is still something the caller asked for and
 * didn't get, so `registerCreateCommand` throws after printing every
 * outcome, to keep the process exiting non-zero.
 */
export async function runCreateWithRepos(
  ctx: AppContext,
  name: string,
  options: CreateOptions,
): Promise<CreateWithReposResult> {
  const handle = await runCreate(ctx, name, options)
  const sources = options.repo ?? []

  const outcomes = await runConcurrently(
    sources.map((source) => ({
      name: defaultAlias(source),
      call: () => addRepo(workspaceContext(ctx), handle.dir, { source, global: options.global }),
    })),
  )

  const repoOutcomes: CreateRepoOutcome[] = outcomes.map((outcome, index) => {
    const source = sources[index] as string
    if (outcome.value) return { source, result: outcome.value }
    return {
      source,
      failure: { source, cancelled: outcome.cancelled, reason: outcome.cancelled ? 'cancelled' : (outcome.errorMessage ?? 'failed') },
    }
  })

  return { handle, repoOutcomes }
}

export function registerCreateCommand(program: Command, ctx: AppContext): void {
  program
    .command('create <name>')
    .description('Create a new workspace')
    .option('--dir <path>', 'directory to create the workspace in (default: ./<name>)')
    .option('--repo <source>', 'repo to add (repeatable)', collectRepo, [] as string[])
    .option('--global', "register each --repo's alias globally instead of locally to this workspace")
    .action(async (name: string, options: CreateOptions) => {
      const { handle, repoOutcomes } = await runCreateWithRepos(ctx, name, options)
      console.log(ctx.ui.color.green(`Created workspace "${handle.name}" at ${handle.dir}`))

      if (repoOutcomes.length === 0) {
        console.log(`Add a repo with: spork workspace add-repo ${handle.name} <repo>`)
        return
      }

      const failures: CreateRepoFailure[] = []
      for (const outcome of repoOutcomes) {
        if (outcome.result) {
          printAddRepoResult(ctx, handle.name, outcome.result)
        } else if (outcome.failure) {
          failures.push(outcome.failure)
          console.log(ctx.ui.color.red(`Failed to add "${outcome.source}": ${outcome.failure.reason}`))
        }
      }

      if (failures.length > 0) {
        throw new SporkError(`${failures.length} of ${repoOutcomes.length} --repo adds did not succeed: ${failures.map((f) => f.source).join(', ')}`)
      }
    })
}
