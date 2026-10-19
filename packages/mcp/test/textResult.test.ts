import { describe, expect, it } from 'vitest'
import { jsonResult, textResult } from '../src/textResult.js'

describe('textResult', () => {
  it('wraps text in a single-block CallToolResult', () => {
    expect(textResult('hello')).toEqual({ content: [{ type: 'text', text: 'hello' }] })
  })
})

describe('jsonResult', () => {
  it('pretty-prints the value as the text block', () => {
    const result = jsonResult({ a: 1 })

    expect(result.content[0]?.text).toBe(JSON.stringify({ a: 1 }, null, 2))
  })
})
