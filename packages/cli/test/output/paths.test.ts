import { describe, expect, it } from 'vitest'
import { tildify, workspaceLocation } from '../../src/output/paths.js'

describe('tildify', () => {
  it('shortens paths under the home directory', () => {
    expect(tildify('/home/kris/code/app', '/home/kris')).toBe('~/code/app')
    expect(tildify('/home/kris', '/home/kris')).toBe('~')
  })

  it('leaves other paths, including look-alike prefixes, untouched', () => {
    expect(tildify('/tmp/app', '/home/kris')).toBe('/tmp/app')
    expect(tildify('/home/kristina/app', '/home/kris')).toBe('/home/kristina/app')
  })

  it('defaults to the real home directory', () => {
    expect(tildify('/not/under/home')).toBe('/not/under/home')
  })
})

describe('workspaceLocation', () => {
  const home = '/home/kris'

  it('is null for a workspace at SPORK_WORKSPACE_DIR/<name>, including nested names', () => {
    expect(workspaceLocation({ name: 'demo', dir: '/home/kris/ws/demo' }, '/home/kris/ws', home)).toBeNull()
    expect(workspaceLocation({ name: 'kris/demo', dir: '/home/kris/ws/kris/demo' }, '/home/kris/ws/', home)).toBeNull()
  })

  it('is the shortened directory for a workspace anywhere else', () => {
    expect(workspaceLocation({ name: 'root', dir: '/home/kris/code' }, '/home/kris/ws', home)).toBe('~/code')
  })

  it('is always shown without SPORK_WORKSPACE_DIR', () => {
    expect(workspaceLocation({ name: 'demo', dir: '/home/kris/ws/demo' }, undefined, home)).toBe('~/ws/demo')
  })
})
