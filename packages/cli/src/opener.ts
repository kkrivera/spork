import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface OpenOutcome {
  ok: boolean
  reason?: string
}

export interface Opener {
  open(filePath: string): Promise<OpenOutcome>
}

/** Shells out to the `code` CLI. Injected wherever a command needs to open a file, so it's mockable in tests. */
export function createCodeOpener(): Opener {
  return {
    async open(filePath: string): Promise<OpenOutcome> {
      try {
        await execFileAsync('code', [filePath])
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}
