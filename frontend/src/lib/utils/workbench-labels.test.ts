import { describe, expect, it } from 'vitest'
import { versionDateLabel, versionPrefix } from './workbench-labels'

describe('workbench display-only version labels', () => {
  it('same_day_and_same_second_versions_remain_distinct', () => {
    const ids = ['abcdefgh1', 'abcdefgh2', 'ijklmnop3']
    expect(ids.map(id => versionPrefix(id, ids))).toEqual(['abcdefgh1', 'abcdefgh2', 'ijklmnop'])
    const morning = '2026-11-02T09:00:01Z', later = '2026-11-02T10:00:01Z'
    const format = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', timeZoneName: 'short' })
    expect(versionDateLabel(morning, 'en-US')).toBe(format.format(new Date(morning)))
    expect(versionDateLabel(later, 'en-US')).toBe(format.format(new Date(later)))
    expect(versionDateLabel(morning, 'en-US')).not.toBe(versionDateLabel(later, 'en-US'))
    expect(versionPrefix(ids[0], ids)).not.toBe(versionPrefix(ids[1], ids))
  })
  it('prefix_collision_extends', () => {
    expect(versionPrefix('abcdefghijk1', ['abcdefghijk1', 'abcdefghijk2'])).toBe('abcdefghijk1')
    expect(versionPrefix('abcdefghijk1', ['abcdefghijk1', 'abcdefghijk1'])).toBe('abcdefghijk1')
    expect(versionPrefix('short', ['short', 'different'])).toBe('short')
    expect(versionPrefix('abcdefghijk1', ['abcdefghijk1', 'ijklmnop'])).toBe('abcdefgh')
  })
  it('date_only_never_invents_time', () => {
    for (const language of ['en-US', 'zh-CN']) {
      const format = new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
      expect(versionDateLabel('2026-11-02', language)).toBe(format.format(new Date('2026-11-02T00:00:00Z')))
      expect(versionDateLabel('2026-11-02', language)).not.toMatch(/\d{1,2}:\d{2}|UTC/)
    }
    expect(versionDateLabel(null, 'en-US')).toBeNull()
  })
  it('falls back to en-US for unsupported locale syntax and formats offset timestamps in UTC', () => {
    const value = '2026-11-02T11:00:01+02:00'
    const format = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', timeZoneName: 'short' })
    expect(versionDateLabel(value, 'not_a_locale')).toBe(format.format(new Date('2026-11-02T09:00:01Z')))
  })
})
