import { describe, expect, it } from 'vitest'
import { buttonVariants } from '@/components/ui/button'
import { theme, mix, contrast, utilityColor } from '@/test/design-contrast-fixture'

const surfaces = ['background', 'sidebar', 'card', 'popover', 'muted', 'accent']

describe.each([false, true])('enabled semantic text contrast (dark=%s)', dark => {
  const color = theme(dark)
  for (const variant of ['default', 'destructive'] as const) {
    it.each(surfaces)(`${variant} default and hover on %s are >=4.5`, surface => {
      const classes = buttonVariants({ variant })
      const bg = color(surface)
      const ink = utilityColor(classes, 'text-', color, bg)
      for (const prefix of ['bg-', 'hover:bg-']) {
        const fill = utilityColor(classes, prefix, color, bg)
        expect(contrast(ink, fill), `${variant} ${prefix} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
  it.each(surfaces)('action links and destructive ink remain readable on %s / accent hover', surface => {
    for (const ink of ['primary', 'destructive']) {
      expect(contrast(color(ink), color(surface)), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(color(ink), color('accent')), `${ink} on accent`).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('preserves input selection, sidebar primary, wizard and badge pairings', () => {
    expect(contrast(color('primary-foreground'), color('primary'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('sidebar-primary-foreground'), color('sidebar-primary'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('primary-foreground'), color('fern'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('primary'), mix(color('primary'), color('muted'), 0.1))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('primary'), color('fern-tint'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('destructive'), color('destructive-tint'))).toBeGreaterThanOrEqual(4.5)
  })
  it.each(surfaces)('opaque focus ring token is at least 3:1 against %s', surface => {
    expect(contrast(color('ring'), color(surface))).toBeGreaterThanOrEqual(3)
  })
})
