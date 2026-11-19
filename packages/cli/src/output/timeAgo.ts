import type { WorkspaceActivity } from '@spork/core'

const UNITS: readonly (readonly [string, number])[] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
]

/** "3 hours ago", in the largest whole unit; "just now" under a minute (or for a time in the future). */
export function timeAgo(iso: string, now: Date = new Date()): string | null {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  const seconds = (now.getTime() - then) / 1000
  for (const [unit, size] of UNITS) {
    const count = Math.floor(seconds / size)
    if (count >= 1) return `${count} ${unit}${count === 1 ? '' : 's'} ago`
  }
  return 'just now'
}

/** "Last used 3 hours ago" or "Created 2 days ago", or '' when there's nothing to say. */
export function describeActivity(activity: WorkspaceActivity | null, now: Date = new Date()): string {
  const ago = activity ? timeAgo(activity.at, now) : null
  if (!activity || ago === null) return ''
  return `${activity.kind === 'used' ? 'Last used' : 'Created'} ${ago}`
}
