import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, copyFile: vi.fn(), chmod: vi.fn() }
})

const { execFileSync } = await import('node:child_process')
const fsPromises = await import('node:fs/promises')
const build = await import('../build.js')
const { SEA_FUSE, SEA_MACHO_SEGMENT, SEA_RESOURCE } = build

describe('parseArgs', () => {
  it('reads --entry, --name, and defaults --out-dir', () => {
    expect(build.parseArgs(['--entry', 'src/index.ts', '--name', 'spork'])).toEqual({
      entry: 'src/index.ts',
      name: 'spork',
      outDir: 'dist-sea',
    })
  })

  it('reads an explicit --out-dir', () => {
    expect(build.parseArgs(['--entry', 'e', '--name', 'n', '--out-dir', 'out'])).toMatchObject({ outDir: 'out' })
  })

  it('throws when --entry is missing', () => {
    expect(() => build.parseArgs(['--name', 'spork'])).toThrow('Usage:')
  })
})

describe('outputBinaryName', () => {
  it('appends .exe on win32', () => {
    expect(build.outputBinaryName('spork', 'win32')).toBe('spork.exe')
  })

  it('leaves the name bare on darwin/linux', () => {
    expect(build.outputBinaryName('spork', 'darwin')).toBe('spork')
    expect(build.outputBinaryName('spork', 'linux')).toBe('spork')
  })
})

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'spork-package-binary-'))
  vi.mocked(execFileSync).mockClear()
  vi.mocked(fsPromises.copyFile).mockClear().mockResolvedValue(undefined)
  vi.mocked(fsPromises.chmod).mockClear().mockResolvedValue(undefined)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('writeSeaConfig', () => {
  it('writes the expected SEA config shape', async () => {
    const configPath = path.join(dir, 'spork.sea-config.json')

    await build.writeSeaConfig(configPath, 'bundle.cjs', 'blob.blob')

    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
      main: 'bundle.cjs',
      output: 'blob.blob',
      disableExperimentalSEAWarning: true,
    })
  })
})

describe('generateBlob', () => {
  it('invokes the current node binary with --experimental-sea-config', () => {
    build.generateBlob('spork.sea-config.json')

    expect(execFileSync).toHaveBeenCalledWith(process.execPath, ['--experimental-sea-config', 'spork.sea-config.json'], {
      stdio: 'inherit',
    })
  })
})

describe('copyNodeBinary', () => {
  it('copies the current node binary and makes it executable', async () => {
    await build.copyNodeBinary('/out/spork')

    expect(fsPromises.copyFile).toHaveBeenCalledWith(process.execPath, '/out/spork')
    expect(fsPromises.chmod).toHaveBeenCalledWith('/out/spork', 0o755)
  })
})

describe('removeExistingSignature', () => {
  it('runs codesign --remove-signature on darwin', () => {
    build.removeExistingSignature('/out/spork', 'darwin')

    expect(execFileSync).toHaveBeenCalledWith('codesign', ['--remove-signature', '/out/spork'], { stdio: 'inherit' })
  })

  it('is a no-op on other platforms', () => {
    build.removeExistingSignature('/out/spork', 'linux')

    expect(execFileSync).not.toHaveBeenCalled()
  })
})

describe('injectBlob', () => {
  it('adds --macho-segment-name only on darwin', () => {
    build.injectBlob('/out/spork', 'blob.blob', 'darwin')

    expect(execFileSync).toHaveBeenCalledWith(
      'npx',
      ['--no-install', 'postject', '/out/spork', SEA_RESOURCE, 'blob.blob', '--sentinel-fuse', SEA_FUSE, '--macho-segment-name', SEA_MACHO_SEGMENT],
      { stdio: 'inherit' },
    )
  })

  it('omits --macho-segment-name on linux/windows', () => {
    build.injectBlob('/out/spork', 'blob.blob', 'linux')

    expect(execFileSync).toHaveBeenCalledWith(
      'npx',
      ['--no-install', 'postject', '/out/spork', SEA_RESOURCE, 'blob.blob', '--sentinel-fuse', SEA_FUSE],
      { stdio: 'inherit' },
    )
  })
})

describe('buildBinary', () => {
  it('orchestrates bundle -> sea-config -> blob -> copy -> inject and returns the binary path', async () => {
    const entryPath = path.join(dir, 'entry.ts')
    await writeFile(entryPath, "console.log('hi')\n", 'utf8')

    const binaryPath = await build.buildBinary({ entry: entryPath, name: 'spork', outDir: dir })

    expect(binaryPath).toBe(path.join(dir, 'spork'))
    expect(await readFile(path.join(dir, 'spork-bundle.cjs'), 'utf8')).toContain('console.log')
    expect(JSON.parse(await readFile(path.join(dir, 'spork.sea-config.json'), 'utf8'))).toMatchObject({
      main: path.join(dir, 'spork-bundle.cjs'),
      output: path.join(dir, 'spork.blob'),
    })
    expect(fsPromises.copyFile).toHaveBeenCalledWith(process.execPath, binaryPath)
    expect(fsPromises.chmod).toHaveBeenCalledWith(binaryPath, 0o755)
    expect(execFileSync).toHaveBeenCalledWith(
      process.execPath,
      ['--experimental-sea-config', path.join(dir, 'spork.sea-config.json')],
      { stdio: 'inherit' },
    )
    expect(execFileSync).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['postject', binaryPath, SEA_RESOURCE, path.join(dir, 'spork.blob')]),
      { stdio: 'inherit' },
    )
  })
})
