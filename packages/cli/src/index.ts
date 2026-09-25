#!/usr/bin/env node
import { Command } from 'commander'
import { registerRepoCommands } from './commands/repo/index.js'
import { registerWorkspaceCommands } from './commands/workspace/index.js'
import { createAppContext, type AppContext } from './context.js'
import { createUi } from './output/color.js'

export function createProgram(ctx: AppContext = createAppContext()): Command {
  const program = new Command()

  program
    .name('spork')
    .description('Manage git-worktree-based workspaces spanning multiple repos.')
    .version('0.1.0')
    .option('--color', 'force-enable colored output')
    .option('--no-color', 'disable colored output')

  registerWorkspaceCommands(program, ctx)
  registerRepoCommands(program, ctx)

  return program
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  const program = createProgram()
  await program.parseAsync(argv as string[])
}

export function handleFatalError(error: unknown): void {
  const ui = createUi()
  const message = error instanceof Error ? error.message : String(error)
  console.error(ui.color.red(message))
  process.exitCode = 1
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`

if (isMainModule) {
  main().catch(handleFatalError)
}
