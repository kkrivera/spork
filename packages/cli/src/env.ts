export interface SporkEnv {
  /** SPORK_WORKSPACE_DIR — default parent directory for `workspace create` when `--dir` is omitted. */
  workspaceDir?: string
  /**
   * SPORK_CD_FILE — set by the shell integration (`spork shell-init`) to a
   * temp file it `cd`s to after spork exits; the Terminal target writes
   * the workspace's folder there. Never set by hand.
   */
  cdFile?: string
}

/**
 * The single place every `SPORK_*` environment variable gets read — add a
 * new field here (and to `SporkEnv` above) rather than reading
 * `process.env.SPORK_*` directly from a command. Takes `env` as a
 * parameter (default `process.env`) so it stays testable without mocking
 * the real process environment, same convention `output/color.ts`'s
 * `resolveColorEnabled` already uses.
 */
export function readSporkEnv(env: NodeJS.ProcessEnv = process.env): SporkEnv {
  return {
    workspaceDir: env.SPORK_WORKSPACE_DIR || undefined,
    cdFile: env.SPORK_CD_FILE || undefined,
  }
}
