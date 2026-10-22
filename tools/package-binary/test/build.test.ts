import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

/** `buf.buffer` is the whole (possibly pooled, larger) backing ArrayBuffer — this slices out just `buf`'s own bytes. */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}
const { SEA_FUSE, SEA_MACHO_SEGMENT, SEA_RESOURCE } = build

describe('parseArgs', () => {
  it('reads --entry, --name, and defaults --out-dir/--platform/--arch', () => {
    expect(build.parseArgs(['--entry', 'src/index.ts', '--name', 'spork'])).toEqual({
      entry: 'src/index.ts',
      name: 'spork',
      outDir: 'dist-sea',
      platform: process.platform,
      arch: process.arch,
    })
  })

  it('reads an explicit --out-dir/--platform/--arch', () => {
    expect(
      build.parseArgs(['--entry', 'e', '--name', 'n', '--out-dir', 'out', '--platform', 'linux', '--arch', 'x64']),
    ).toMatchObject({ outDir: 'out', platform: 'linux', arch: 'x64' })
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

describe('nodeArchiveName / nodeDownloadUrl', () => {
  it('names a .tar.gz for darwin/linux, translating darwin/linux platform names verbatim', () => {
    expect(build.nodeArchiveName('v20.18.1', 'darwin', 'arm64')).toBe('node-v20.18.1-darwin-arm64.tar.gz')
    expect(build.nodeArchiveName('v20.18.1', 'linux', 'x64')).toBe('node-v20.18.1-linux-x64.tar.gz')
  })

  it('names a .zip for win32, using "win" instead of "win32"', () => {
    expect(build.nodeArchiveName('v20.18.1', 'win32', 'x64')).toBe('node-v20.18.1-win-x64.zip')
  })

  it('builds the nodejs.org dist URL', () => {
    expect(build.nodeDownloadUrl('v20.18.1', 'node-v20.18.1-linux-x64.tar.gz')).toBe(
      'https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.gz',
    )
  })
})

describe('parseShasum', () => {
  const shasums = [
    '2222222222222222222222222222222222222222222222222222222222222a  node-v20.18.1-darwin-arm64.tar.gz',
    '1111111111111111111111111111111111111111111111111111111111111b  node-v20.18.1-linux-x64.tar.gz',
  ].join('\n')

  it('finds the matching archive’s checksum', () => {
    expect(build.parseShasum(shasums, 'node-v20.18.1-linux-x64.tar.gz')).toBe(
      '1111111111111111111111111111111111111111111111111111111111111b',
    )
  })

  it('throws when nothing matches', () => {
    expect(() => build.parseShasum(shasums, 'node-v20.18.1-win-x64.zip')).toThrow('No checksum found')
  })
})

describe('downloadNodeBinary', () => {
  it('uses an already-cached binary without downloading anything', async () => {
    const cacheDir = path.join(dir, 'cache')
    await mkdir(cacheDir, { recursive: true })
    const cachedBinaryPath = path.join(cacheDir, `node-${process.version}-linux-x64`)
    await writeFile(cachedBinaryPath, 'cached', 'utf8')
    vi.stubGlobal('fetch', vi.fn())

    await build.downloadNodeBinary('/out/spork', 'linux', 'x64', cacheDir)

    expect(fetch).not.toHaveBeenCalled()
    expect(fsPromises.copyFile).toHaveBeenCalledWith(cachedBinaryPath, '/out/spork')
    expect(fsPromises.chmod).toHaveBeenCalledWith('/out/spork', 0o755)
  })

  it('downloads, verifies the checksum, extracts, and caches a target binary not seen before', async () => {
    const cacheDir = path.join(dir, 'cache-miss')
    const archiveBytes = Buffer.from('fake-archive-bytes')
    const sha = createHash('sha256').update(archiveBytes).digest('hex')
    const archiveName = 'node-' + process.version + '-linux-x64.tar.gz'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ arrayBuffer: async () => toArrayBuffer(archiveBytes) })
      .mockResolvedValueOnce({ text: async () => `${sha}  ${archiveName}` })
    vi.stubGlobal('fetch', fetchMock)

    await build.downloadNodeBinary('/out/spork-mcp', 'linux', 'x64', cacheDir)

    expect(fetchMock).toHaveBeenCalledWith(`https://nodejs.org/dist/${process.version}/${archiveName}`)
    expect(fetchMock).toHaveBeenCalledWith(`https://nodejs.org/dist/${process.version}/SHASUMS256.txt`)
    expect(execFileSync).toHaveBeenCalledWith('tar', ['-xzf', path.join(cacheDir, archiveName), '-C', expect.any(String)], {
      stdio: 'inherit',
    })
    const cachedBinaryPath = path.join(cacheDir, `node-${process.version}-linux-x64`)
    expect(fsPromises.copyFile).toHaveBeenCalledWith(expect.stringContaining(path.join('bin', 'node')), cachedBinaryPath)
    expect(fsPromises.copyFile).toHaveBeenCalledWith(cachedBinaryPath, '/out/spork-mcp')
  })
})

describe('downloadNodeBinary — extraction / verification edge cases', () => {
  it('extracts a .zip with unzip for a win32 target', async () => {
    const cacheDir = path.join(dir, 'cache-win')
    const archiveBytes = Buffer.from('fake-archive-bytes')
    const sha = createHash('sha256').update(archiveBytes).digest('hex')
    const archiveName = 'node-' + process.version + '-win-x64.zip'
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ arrayBuffer: async () => toArrayBuffer(archiveBytes) })
        .mockResolvedValueOnce({ text: async () => `${sha}  ${archiveName}` }),
    )

    await build.downloadNodeBinary('/out/spork.exe', 'win32', 'x64', cacheDir)

    expect(execFileSync).toHaveBeenCalledWith(
      'unzip',
      ['-q', '-o', path.join(cacheDir, archiveName), '-d', expect.any(String)],
      { stdio: 'inherit' },
    )
  })

  it('throws on a checksum mismatch without extracting anything', async () => {
    const cacheDir = path.join(dir, 'cache-bad')
    const archiveBytes = Buffer.from('fake-archive-bytes')
    const archiveName = 'node-' + process.version + '-linux-x64.tar.gz'
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ arrayBuffer: async () => toArrayBuffer(archiveBytes) })
        .mockResolvedValueOnce({ text: async () => `deadbeef  ${archiveName}` }),
    )

    await expect(build.downloadNodeBinary('/out/spork', 'linux', 'x64', cacheDir)).rejects.toThrow('Checksum mismatch')
    expect(execFileSync).not.toHaveBeenCalled()
  })
})

describe('copyNodeBinary', () => {
  it('copies the current node binary and makes it executable', async () => {
    await build.copyNodeBinary('/out/spork')

    expect(fsPromises.copyFile).toHaveBeenCalledWith(process.execPath, '/out/spork')
    expect(fsPromises.chmod).toHaveBeenCalledWith('/out/spork', 0o755)
  })
})

/** Temporarily forces `process.platform` (it's configurable, just not writable by plain assignment). */
function withHostPlatform(platform: NodeJS.Platform, fn: () => void): void {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    fn()
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true })
  }
}

describe('removeExistingSignature', () => {
  it('runs codesign --remove-signature when both the target and host are darwin', () => {
    withHostPlatform('darwin', () => build.removeExistingSignature('/out/spork', 'darwin'))

    expect(execFileSync).toHaveBeenCalledWith('codesign', ['--remove-signature', '/out/spork'], { stdio: 'inherit' })
  })

  it('is a no-op on a non-darwin target', () => {
    build.removeExistingSignature('/out/spork', 'linux')

    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('skips with a warning for a darwin target on a non-darwin host (codesign does not exist there)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    withHostPlatform('linux', () => build.removeExistingSignature('/out/spork', 'darwin'))

    expect(execFileSync).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('codesign is only available on a macOS host'))
    warnSpy.mockRestore()
  })
})

describe('adHocSign', () => {
  it('runs codesign --sign - --force when both the target and host are darwin', () => {
    withHostPlatform('darwin', () => build.adHocSign('/out/spork', 'darwin'))

    expect(execFileSync).toHaveBeenCalledWith('codesign', ['--sign', '-', '--force', '/out/spork'], { stdio: 'inherit' })
  })

  it('is a no-op on a non-darwin target', () => {
    build.adHocSign('/out/spork', 'linux')

    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('skips with a warning for a darwin target on a non-darwin host (codesign does not exist there)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    withHostPlatform('linux', () => build.adHocSign('/out/spork', 'darwin'))

    expect(execFileSync).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('codesign is only available on a macOS host'))
    warnSpy.mockRestore()
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
