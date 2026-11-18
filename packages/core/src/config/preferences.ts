import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Small, per-machine choices spork remembers between runs, stored as JSON
 * (`PREFERENCES_PATH`). Every field is optional, so a missing or older
 * file just means "nothing remembered yet".
 */
export interface Preferences {
  /** Set once the one-time "add the shell integration?" question was asked, whatever the answer. */
  shellIntegrationOffered?: boolean
}

/** The stored preferences, or `{}` when the file is missing or unreadable. */
export async function readPreferences(filePath: string): Promise<Preferences> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Preferences) : {}
  } catch {
    return {}
  }
}

/** Merges `changes` into the stored preferences. */
export async function updatePreferences(filePath: string, changes: Preferences): Promise<void> {
  const next = { ...(await readPreferences(filePath)), ...changes }
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`)
}
