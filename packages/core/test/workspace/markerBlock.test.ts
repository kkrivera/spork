import { describe, expect, it } from 'vitest'
import { BLOCK_BEGIN, BLOCK_END, stripBlock, upsertBlock } from '../../src/workspace/markerBlock.js'

const block = (body: string): string => `${BLOCK_BEGIN}\n${body}\n${BLOCK_END}`

describe('upsertBlock', () => {
  it('writes just the block when there is no file yet', () => {
    expect(upsertBlock(null, 'hello')).toBe(`${block('hello')}\n`)
  })

  it('treats an empty file the same as no file', () => {
    expect(upsertBlock('  \n', 'hello')).toBe(`${block('hello')}\n`)
  })

  it("appends the block after the user's own content when there are no markers yet", () => {
    expect(upsertBlock('# Mine\n\nmy notes\n', 'hello')).toBe(`# Mine\n\nmy notes\n\n${block('hello')}\n`)
  })

  it('replaces only what is between the markers, keeping content on both sides', () => {
    const existing = `# Mine\n\n${block('old')}\n\n## After\nmore\n`

    expect(upsertBlock(existing, 'new')).toBe(`# Mine\n\n${block('new')}\n\n## After\nmore\n`)
  })

  it('is idempotent', () => {
    const once = upsertBlock('# Mine\n', 'hello')

    expect(upsertBlock(once, 'hello')).toBe(once)
  })

  it('appends rather than guessing when a begin marker has no matching end', () => {
    const existing = `${BLOCK_BEGIN}\nhalf a block\n`

    expect(upsertBlock(existing, 'hello')).toBe(`${existing.trimEnd()}\n\n${block('hello')}\n`)
  })
})

describe('stripBlock', () => {
  it('returns null when the file was only spork\'s block', () => {
    expect(stripBlock(`${block('hello')}\n`)).toBeNull()
  })

  it("restores the user's own content exactly as it was before the block was appended", () => {
    const original = '# Mine\n\nmy notes\n'

    expect(stripBlock(upsertBlock(original, 'hello'))).toBe(original)
  })

  it('joins the content on either side of a block in the middle', () => {
    expect(stripBlock(`# Top\n\n${block('x')}\n\n# Bottom\n`)).toBe('# Top\n\n# Bottom\n')
  })

  it('leaves a file with no block unchanged', () => {
    expect(stripBlock('# Mine\n')).toBe('# Mine\n')
  })
})
