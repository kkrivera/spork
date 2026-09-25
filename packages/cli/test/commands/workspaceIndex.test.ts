import { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import { registerWorkspaceCommands } from '../../src/commands/workspace/index.js'
import { createUi } from '../../src/output/color.js'

describe('registerWorkspaceCommands', () => {
  it('registers a "workspace" command with every v1 subcommand', () => {
    const program = new Command()
    const ctx = { reposRoot: '/repos', registryPath: '/registry.json', repoRegistryPath: '/repos.json', ui: createUi({ argv: ['--no-color'] }) }

    registerWorkspaceCommands(program, ctx)

    const workspace = program.commands.find((cmd) => cmd.name() === 'workspace')
    expect(workspace).toBeDefined()

    const subcommandNames = workspace?.commands.map((cmd) => cmd.name())
    expect(subcommandNames).toEqual(
      expect.arrayContaining(['create', 'add-repo', 'remove-repo', 'remove', 'list', 'status', 'open']),
    )
  })
})
