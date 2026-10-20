import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../build.js', () => ({ buildBinary: vi.fn() }))

const { buildBinary } = await import('../build.js')
const { ALL_TARGETS, parseArgs, resolveTargets, buildAll } = await import('../build-all.js')

beforeEach(() => {
  vi.mocked(buildBinary).mockReset()
})

describe('parseArgs', () => {
  it('reads --platform', () => {
    expect(parseArgs(['--platform', 'linux'])).toEqual({ platform: 'linux' })
  })

  it('defaults to no filter', () => {
    expect(parseArgs([])).toEqual({ platform: undefined })
  })
})

describe('resolveTargets', () => {
  it('returns every target when unfiltered', () => {
    expect(resolveTargets(undefined)).toEqual(ALL_TARGETS)
  })

  it('filters to just the matching platform', () => {
    expect(resolveTargets('darwin')).toEqual([
      { platform: 'darwin', arch: 'arm64' },
      { platform: 'darwin', arch: 'x64' },
    ])
  })
})

describe('buildAll', () => {
  it('builds spork and spork-mcp for every target, into per-target subfolders', async () => {
    vi.mocked(buildBinary).mockImplementation(async (args) => path.join(args.outDir, args.name))

    const paths = await buildAll('win32', 'out')

    expect(buildBinary).toHaveBeenCalledTimes(2)
    expect(buildBinary).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'spork', platform: 'win32', arch: 'x64', outDir: path.join('out', 'win32-x64') }),
    )
    expect(buildBinary).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'spork-mcp', platform: 'win32', arch: 'x64', outDir: path.join('out', 'win32-x64') }),
    )
    expect(paths).toEqual([path.join('out', 'win32-x64', 'spork'), path.join('out', 'win32-x64', 'spork-mcp')])
  })

  it('builds every target when unfiltered', async () => {
    vi.mocked(buildBinary).mockResolvedValue('irrelevant')

    await buildAll(undefined)

    expect(buildBinary).toHaveBeenCalledTimes(ALL_TARGETS.length * 2)
  })

  it('rejects a platform with no matching target', async () => {
    await expect(buildAll('aix' as never)).rejects.toThrow('No targets match platform')
    expect(buildBinary).not.toHaveBeenCalled()
  })
})
