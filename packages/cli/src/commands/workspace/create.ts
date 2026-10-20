import path from 'node:path'
import { codeWorkspaceFilePath, createAndRegisterWorkspace, SporkError, type WorkspaceHandle } from '@spork/core'
import { NotInteractiveError, select, type PromptOption } from '@spork/prompts'
import type { Command } from 'commander'
import { workspaceContext, type AppContext } from '../../context.js'
import {
  defaultLaunchDeps,
  launchWorkspace,
  LAUNCH_TARGET_OPTIONS,
  type LaunchDeps,
  type LaunchTarget,
} from '../../launchTarget.js'
import { addReposToWorkspace, type AddRepoBatchFailure, type AddRepoBatchOutcome } from './addReposBatch.js'
import { printAddRepoResult } from './addRepo.js'
import { runList } from '../repo/list.js'

export interface CreateOptions {
  dir?: string
  repo?: string[]
  /** Register each --repo's alias globally instead of locally to the new workspace (the default). */
  global?: boolean
}

function collectRepo(value: string, previous: string[]): string[] {
  return [...previous, value]
}

/**
 * `--dir` names a *parent* directory, not the exact target — the workspace
 * always lands at `<parent>/<name>` (parent defaults to `$SPORK_WORKSPACE_DIR`,
 * then cwd), never at `--dir` verbatim. This guarantees the folder's
 * basename always matches `name`, which is also every worktree's branch
 * name verbatim (shared by every repo in the workspace — see `addRepo`) —
 * letting them diverge would mean a workspace whose folder and branch
 * disagree about what it's even called.
 */
export async function runCreate(ctx: AppContext, name: string, options: CreateOptions): Promise<WorkspaceHandle> {
  const dir = path.resolve(options.dir ?? ctx.env.workspaceDir ?? process.cwd(), name)
  return createAndRegisterWorkspace(workspaceContext(ctx), ctx.registryPath, { name, dir })
}

export interface CreateWithReposResult {
  handle: WorkspaceHandle
  repoOutcomes: AddRepoBatchOutcome[]
}

/**
 * Decides which repo sources to add when no `--repo` was given: an explicit
 * `--repo` always wins outright (no prompt at all). Otherwise, lists known
 * repos the same way `repo list` does and — only if there's actually
 * something to pick from — offers a multi-select. `select` throws
 * `NotInteractiveError` synchronously when the terminal can't support one
 * (CI, a pipe, a script); that's caught here and treated the same as
 * "nothing to pick from": fall back to creating an empty workspace, exactly
 * today's non-interactive behavior. A real cancel (Esc/Ctrl+C) is
 * different — the user started picking and backed out, so that becomes a
 * `SporkError`, same as every other cancelled-prompt path in this CLI.
 */
async function resolveRepoSources(ctx: AppContext, name: string, options: CreateOptions): Promise<string[]> {
  if (options.repo && options.repo.length > 0) return options.repo

  const candidates = await runList(ctx)
  if (candidates.length === 0) return []

  const promptOptions: PromptOption<string>[] = candidates.map((repo) => ({
    label: repo.alias,
    value: repo.source,
    hint: `${repo.source} (${repo.scope})`,
  }))

  let chosen: string[] | null
  try {
    chosen = await select({ message: `Select repos to add to "${name}"`, options: promptOptions, mode: 'multi' })
  } catch (error) {
    if (error instanceof NotInteractiveError) return []
    throw error
  }

  if (chosen === null) throw new SporkError('Cancelled.')
  return chosen
}

/**
 * Creates the workspace, then adds every resolved repo source via
 * `addReposBatch.ts`'s `addReposToWorkspace` (see `resolveRepoSources` for
 * where those sources come from, `--repo` or an interactive pick) — shared
 * with `add-repo`'s own zero-argument, pick-from-the-registry flow, so the
 * live-dashboard/best-effort batch-add logic only lives in one place.
 * Not atomic, and not fail-fast: every `--repo` runs regardless of a
 * sibling's failure, so the already-created workspace ends up with whatever
 * repos succeeded. A failed or cancelled `--repo` is still something the
 * caller asked for and didn't get, so `registerCreateCommand` throws after
 * printing every outcome, to keep the process exiting non-zero.
 */
export async function runCreateWithRepos(
  ctx: AppContext,
  name: string,
  options: CreateOptions,
): Promise<CreateWithReposResult> {
  const handle = await runCreate(ctx, name, options)
  const sources = await resolveRepoSources(ctx, name, options)
  const repoOutcomes = await addReposToWorkspace(ctx, handle.dir, sources, { global: options.global })

  return { handle, repoOutcomes }
}

type OfferChoice = LaunchTarget | 'skip'

const OFFER_OPTIONS: PromptOption<OfferChoice>[] = [...LAUNCH_TARGET_OPTIONS, { label: 'Not now', value: 'skip' }]

/**
 * Offers to launch the freshly-created workspace — the user is likely
 * creating one to start working in it right away. A 3-way pick (VS Code /
 * Claude / not now) rather than a yes/no confirm, since there are now two
 * real ways to open it. Skipped silently (not an error) both when `select`
 * can't prompt (`NotInteractiveError`: CI, a pipe, a script) and when the
 * user explicitly backs out (Esc) or picks "Not now" — this offer is
 * optional by construction, unlike `open`'s own mandatory pick, so neither
 * outcome is treated as a cancelled-prompt error the way other pickers do.
 */
async function offerToLaunchWorkspace(ctx: AppContext, handle: WorkspaceHandle, deps: LaunchDeps): Promise<void> {
  let chosen: OfferChoice[] | null
  try {
    chosen = await select({ message: `Open "${handle.name}" now?`, options: OFFER_OPTIONS, mode: 'single' })
  } catch (error) {
    if (error instanceof NotInteractiveError) return
    throw error
  }

  const target = chosen?.[0]
  if (!target || target === 'skip') {
    console.log(`Open later with: spork workspace open ${handle.name}`)
    return
  }

  const filePath = codeWorkspaceFilePath(handle.dir, handle.name)
  const outcome = await launchWorkspace(target, handle.dir, filePath, deps)
  if (target === 'code') {
    if (outcome.ok) {
      console.log(ctx.ui.color.green(`Opened ${filePath}`))
    } else {
      console.log(`Couldn't launch the "code" CLI (${outcome.reason}). Open manually: ${filePath}`)
    }
  } else if (!outcome.ok) {
    console.log(`Couldn't launch Claude (${outcome.reason}). Run it yourself: cd ${handle.dir} && claude`)
  }
}

export function registerCreateCommand(program: Command, ctx: AppContext, deps: LaunchDeps = defaultLaunchDeps()): void {
  program
    .command('create <name>')
    .description('Create a new workspace')
    .option('--dir <path>', 'parent directory to create the workspace in, as <path>/<name> (default: $SPORK_WORKSPACE_DIR, or cwd)')
    .option('--repo <source>', 'repo to add (repeatable)', collectRepo, [] as string[])
    .option('--global', "register each --repo's alias globally instead of locally to this workspace")
    .action(async (name: string, options: CreateOptions) => {
      const { handle, repoOutcomes } = await runCreateWithRepos(ctx, name, options)
      console.log(ctx.ui.color.green(`Created workspace "${handle.name}" at ${handle.dir}`))

      const failures: AddRepoBatchFailure[] = []
      if (repoOutcomes.length === 0) {
        console.log(`Add a repo with: spork workspace add-repo ${handle.name} <repo>`)
      } else {
        for (const outcome of repoOutcomes) {
          if (outcome.result) {
            printAddRepoResult(ctx, handle.name, outcome.result)
          } else if (outcome.failure) {
            failures.push(outcome.failure)
            console.log(ctx.ui.color.red(`Failed to add "${outcome.source}": ${outcome.failure.reason}`))
          }
        }
      }

      await offerToLaunchWorkspace(ctx, handle, deps)

      if (failures.length > 0) {
        throw new SporkError(`${failures.length} of ${repoOutcomes.length} --repo adds did not succeed: ${failures.map((f) => f.source).join(', ')}`)
      }
    })
}
