import { resolveWorkspaceDir } from '@spork/core'
import type { PromptOutputStream } from '@spork/prompts'
import type { Command } from 'commander'
import type { AppContext } from '../../context.js'
import { pickWorkspaceName } from './pickWorkspace.js'

/**
 * Resolves a workspace's full directory, for scripts:
 * `cd "$(spork workspace path demo)"`. `workspace` is optional, resolved
 * like every other optional-workspace command (cwd's enclosing workspace,
 * then a picker) — but the picker draws on stderr, so stdout carries
 * nothing but the path.
 */
export async function runPath(ctx: AppContext, workspace: string | undefined): Promise<string> {
  const name =
    workspace ??
    (await pickWorkspaceName(
      ctx,
      'Select a workspace',
      'Multiple workspaces are registered — pass one explicitly: spork workspace path <name>',
      { output: process.stderr as unknown as PromptOutputStream },
    ))
  return resolveWorkspaceDir(ctx.registryPath, name)
}

export function registerPathCommand(program: Command, ctx: AppContext): void {
  program
    .command('path [workspace]')
    .description("Print a workspace's full path, e.g. cd \"$(spork workspace path <name>)\" (omit to pick from a list)")
    .action(async (workspace: string | undefined) => {
      console.log(await runPath(ctx, workspace))
    })
}
