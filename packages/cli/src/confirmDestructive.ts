import { SporkError } from '@spork/core'
import { confirm, NotInteractiveError } from '@spork/prompts'

/**
 * Guards a destructive action behind a yes/no confirmation. `yes` is a
 * command's own `--yes`/`-y` flag — pass `true` to skip the prompt entirely
 * (the escape hatch a script/CI run needs, since `confirm` can't prompt
 * without a TTY anyway). Without it and without a TTY, this fails with a
 * clear `SporkError` demanding `--yes` rather than silently proceeding with
 * (or silently skipping) something destructive. Declining the prompt itself
 * becomes `SporkError`'s usual `'Cancelled.'`, same as every other
 * cancelled-prompt path in this CLI. Defaults to "no" on bare Enter —
 * unlike `workspace create`'s open-in-VS-Code confirm, there's no safe
 * default to lean toward here.
 */
export async function confirmDestructive(message: string, yes: boolean | undefined): Promise<void> {
  if (yes) return

  let ok: boolean
  try {
    ok = await confirm({ message, defaultValue: false })
  } catch (error) {
    if (error instanceof NotInteractiveError) {
      throw new SporkError(`${message} Pass --yes to confirm without prompting (no TTY to prompt here).`)
    }
    throw error
  }

  if (!ok) throw new SporkError('Cancelled.')
}
