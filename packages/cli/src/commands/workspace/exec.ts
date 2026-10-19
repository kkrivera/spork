import { resolveWorkspaceDir } from '@spork/core'
import type { Command } from 'commander'
import { createShellExecutor, type CommandExecutor, type ExecResult } from '../../commandExecutor.js'
import type { AppContext } from '../../context.js'
import { pickWorkspaceName } from './pickWorkspace.js'

export interface ExecOptions {
  /** Which workspace to run in — defaults to the cwd's enclosing workspace, or a picker (see `pickWorkspace.ts`). */
  workspace?: string
}

export interface RunExecResult extends ExecResult {
  workspace: string
  dir: string
}

/**
 * Runs `command` at the root of a workspace (not inside any one repo's own
 * worktree) via `executor` — arbitrary, e.g. a root-level `docker-compose
 * up` or a script that starts every service a workspace spans. `workspace`
 * is optional, resolved the same way every other optional-workspace
 * command does (`pickWorkspace.ts`'s `pickWorkspaceName`): the cwd's
 * enclosing workspace if there is one, otherwise a single-select.
 * `onResolved`, if given, fires once the workspace is known but *before*
 * the (possibly long-running) command starts — `registerExecCommand`
 * uses it to print which workspace got picked, since otherwise there'd be
 * no feedback at all until the command itself produces output.
 */
export async function runExec(
  ctx: AppContext,
  command: string,
  options: ExecOptions,
  executor: CommandExecutor,
  onResolved?: (info: { workspace: string; dir: string }) => void,
): Promise<RunExecResult> {
  const workspace =
    options.workspace ??
    (await pickWorkspaceName(
      ctx,
      'Select a workspace to run in',
      'Multiple workspaces are registered — pass one explicitly: spork workspace exec <command> --workspace <name>',
    ))
  const dir = await resolveWorkspaceDir(ctx.registryPath, workspace)
  onResolved?.({ workspace, dir })

  const result = await executor.run(command, dir)
  return { workspace, dir, ...result }
}

export function registerExecCommand(program: Command, ctx: AppContext, executor: CommandExecutor = createShellExecutor()): void {
  program
    .command('exec <command>')
    .description('Run an arbitrary command at the root of a workspace (omit --workspace to auto-detect/pick it)')
    .option('-w, --workspace <name>', 'workspace to run in (default: auto-detected from cwd, or pick from a list)')
    .action(async (command: string, options: ExecOptions) => {
      const result = await runExec(ctx, command, options, executor, ({ workspace, dir }) => {
        console.log(ctx.ui.color.dim(`Running "${command}" in "${workspace}" (${dir})`))
      })

      process.exitCode = result.signal ? 1 : (result.exitCode ?? 0)
    })
}
