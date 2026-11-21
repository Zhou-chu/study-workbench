import { describe, expect, it } from 'vitest'
import { lengthPixels, matchesWorkbenchMedia } from './workbench-css'

describe('bounded authored-CSS evaluator assumptions', () => {
  it.each([14, 16, 20, 24])('evaluates min-width rem using a %spx initial font, not fixed16px or unconditional true', font => {
    expect(matchesWorkbenchMedia('(min-width: 80rem)', 80 * font - 1, false, font)).toBe(false)
    expect(matchesWorkbenchMedia('(min-width: 80rem)', 80 * font, false, font)).toBe(true)
    expect(matchesWorkbenchMedia('(width >= 80rem)', 80 * font - 1, false, font)).toBe(false)
    expect(matchesWorkbenchMedia('(width >= 80rem)', 80 * font, false, font)).toBe(true)
    expect(lengthPixels('calc(100% - 5rem)', 1000, font)).toBe(1000 - 5 * font)
  })
  it('preserves inclusive pixel phone bounds and the independent coarse-pointer alternative', () => {
    const query = '(max-width: 640px), (pointer: coarse)'
    expect(matchesWorkbenchMedia(query, 640)).toBe(true)
    expect(matchesWorkbenchMedia(query, 641)).toBe(false)
    expect(matchesWorkbenchMedia(query, 1600, true, 24)).toBe(true)
    expect(matchesWorkbenchMedia('(min-width: 80rem) and (pointer: coarse)', 1600, false, 20)).toBe(false)
  })
  it.each(['(orientation: landscape)', '(min-width: 80em)', '(min-width: 1.2.3rem)', '(width ~ 80rem)', 'screen and (min-width: 1px)', '(max-width: 640px), (unknown: true)'])('rejects unsupported query syntax instead of silently passing: %s', query => {
    expect(() => matchesWorkbenchMedia(query, 390)).toThrow(/Unsupported media query/)
  })
})
