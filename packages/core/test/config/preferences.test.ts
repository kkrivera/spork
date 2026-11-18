import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readPreferences, updatePreferences } from '../../src/config/preferences.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'spork-prefs-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('preferences', () => {
  it('reads as empty when the file is missing, malformed, or not an object', async () => {
    const file = path.join(dir, 'preferences.json')
    expect(await readPreferences(file)).toEqual({})
    await writeFile(file, '{oops')
    expect(await readPreferences(file)).toEqual({})
    await writeFile(file, '[1]')
    expect(await readPreferences(file)).toEqual({})
  })

  it('merges changes into what is stored, creating the folder', async () => {
    const file = path.join(dir, 'nested', 'preferences.json')
    await updatePreferences(file, { shellIntegrationOffered: true })
    await writeFile(file, JSON.stringify({ shellIntegrationOffered: true, other: 1 }))

    await updatePreferences(file, { shellIntegrationOffered: false })

    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ shellIntegrationOffered: false, other: 1 })
  })
})
