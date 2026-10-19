import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/** A single-text-block tool result — the shape every tool here returns on success. */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] }
}

/** `textResult`, pretty-printed as JSON — for a tool whose result is naturally a list/object rather than a sentence. */
export function jsonResult(value: unknown): CallToolResult {
  return textResult(JSON.stringify(value, null, 2))
}
