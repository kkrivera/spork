import { describe, expect, it } from 'vitest'
import { describeActivity, timeAgo } from '../../src/output/timeAgo.js'

const now = new Date('2026-03-10T12:00:00.000Z')
const before = (seconds: number): string => new Date(now.getTime() - seconds * 1000).toISOString()

describe('timeAgo', () => {
  it('uses the largest whole unit, singular or plural', () => {
    expect(timeAgo(before(30), now)).toBe('just now')
    expect(timeAgo(before(60), now)).toBe('1 minute ago')
    expect(timeAgo(before(59 * 60), now)).toBe('59 minutes ago')
    expect(timeAgo(before(2 * 3600), now)).toBe('2 hours ago')
    expect(timeAgo(before(3 * 86400), now)).toBe('3 days ago')
    expect(timeAgo(before(14 * 86400), now)).toBe('2 weeks ago')
    expect(timeAgo(before(45 * 86400), now)).toBe('1 month ago')
    expect(timeAgo(before(800 * 86400), now)).toBe('2 years ago')
  })

  it('says "just now" for a time in the future, and gives up on one it can\'t read', () => {
    expect(timeAgo(before(-600), now)).toBe('just now')
    expect(timeAgo('not a date', now)).toBeNull()
  })
})

describe('describeActivity', () => {
  it('says whether the workspace was last used or only created', () => {
    expect(describeActivity({ kind: 'used', at: before(7200) }, now)).toBe('Last used 2 hours ago')
    expect(describeActivity({ kind: 'created', at: before(86400) }, now)).toBe('Created 1 day ago')
  })

  it('says nothing when there is no time, or an unreadable one', () => {
    expect(describeActivity(null, now)).toBe('')
    expect(describeActivity({ kind: 'used', at: '' }, now)).toBe('')
  })
})
