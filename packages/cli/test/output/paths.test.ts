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

  it('is the folder a workspace sits in, since its name says the rest', () => {
    expect(workspaceLocation({ name: 'demo', dir: '/home/kris/ws/demo' }, home)).toBe('~/ws')
    expect(workspaceLocation({ name: 'kris/demo', dir: '/home/kris/ws/kris/demo' }, home)).toBe('~/ws')
    expect(workspaceLocation({ name: 'demo', dir: '/demo' }, home)).toBe('/')
  })

  it("is the whole directory when it doesn't end in the name", () => {
    expect(workspaceLocation({ name: 'root', dir: '/home/kris/code' }, home)).toBe('~/code')
    expect(workspaceLocation({ name: 'demo', dir: '/home/kris/my-demo' }, home)).toBe('~/my-demo')
  })
})
