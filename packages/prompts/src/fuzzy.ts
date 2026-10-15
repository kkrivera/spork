export interface FuzzyMatch {
  score: number
  /** Matched character indices into `text` (not `query`), for highlighting. */
  matches: number[]
}

const SEPARATORS = new Set([' ', '/', '-', '_', '.'])

/**
 * A subsequence match: every character of `query` must appear in `text`, in
 * order, case-insensitively — `null` if it doesn't fit at all. Each query
 * character greedily matches the earliest available position after the
 * previous match (not a globally optimal alignment, just a simple,
 * deterministic one — plenty for fuzzy-filtering a few dozen repo names).
 * Scored to favor a contiguous run and a match right after a separator
 * (`/`, `-`, `_`, `.`, space) or at the very start, so typing "iam" ranks
 * `iam-privilege-catalog` above a name that merely contains those letters
 * scattered apart. An empty `query` matches everything with score `0` and
 * no highlighted positions — callers should skip score-sorting in that case
 * and keep the original list order instead.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  if (query.length === 0) return { score: 0, matches: [] }

  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const matches: number[] = []

  let searchFrom = 0
  let previousMatchIndex = -1
  let score = 0

  for (const queryChar of q) {
    const foundAt = t.indexOf(queryChar, searchFrom)
    if (foundAt === -1) return null

    const isConsecutive = previousMatchIndex !== -1 && foundAt === previousMatchIndex + 1
    const isAfterSeparator = foundAt === 0 || SEPARATORS.has(t.charAt(foundAt - 1))

    score += 1
    if (isConsecutive) score += 5
    if (isAfterSeparator) score += 10

    matches.push(foundAt)
    previousMatchIndex = foundAt
    searchFrom = foundAt + 1
  }

  return { score, matches }
}
