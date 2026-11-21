import { describe, expect, it } from 'vitest'
import { pdfRenderSizing } from './pdf-render-sizing'

describe('pdfRenderSizing', () => {
  it('fit_and_numeric_zoom_have_separate_css_and_raster_size', () => {
    expect(pdfRenderSizing(600, 800, 300, 'fit', 2)).toMatchObject({ cssWidth: 300, cssHeight: 400, scale: 0.5, rasterScale: 2, pixelWidth: 600, pixelHeight: 800 })
    expect(pdfRenderSizing(600, 800, 300, 1, 2)).toMatchObject({ cssWidth: 600, cssHeight: 800, scale: 1, rasterScale: 2, pixelWidth: 1200, pixelHeight: 1600 })
    expect(pdfRenderSizing(600, 800, 1, 'fit', 1)?.scale).toBeCloseTo(1 / 600)
    expect(pdfRenderSizing(600, 800, 10000, 'fit', 1)?.scale).toBe(3)
    for (const zoom of [NaN, Infinity, -Infinity]) expect(pdfRenderSizing(600, 800, 300, zoom, 1)?.scale).toBe(1)
    expect(pdfRenderSizing(600, 800, 300, 0, 1)?.scale).toBe(0.25)
    expect(pdfRenderSizing(600, 800, 300, 9, 1)?.scale).toBe(3)
    for (const dpr of [NaN, Infinity, -1, 0]) expect(pdfRenderSizing(600, 800, 300, 1, dpr)?.rasterScale).toBe(1)
  })
  it('bounds_extreme_aspect_ratio_and_dpr', () => {
    for (const [width, height] of [[600, 600], [600, 800], [100000, 1], [1, 100000]]) {
      for (const container of [1, 300, 1920]) for (const zoom of ['fit', 0.25, 1, 3] as const) for (const dpr of [1, 2, 8]) {
        const size = pdfRenderSizing(width, height, container, zoom, dpr)!
        expect(size).not.toBeNull()
        expect(size.pixelWidth).toBeGreaterThanOrEqual(1)
        expect(size.pixelHeight).toBeGreaterThanOrEqual(1)
        expect(size.pixelWidth).toBeLessThanOrEqual(3200)
        expect(size.pixelHeight).toBeLessThanOrEqual(3200)
        expect(size.pixelWidth * size.pixelHeight).toBeLessThanOrEqual(10240000)
        expect(size.pixelWidth).toBe(Math.max(1, Math.floor(size.cssWidth * size.rasterScale)))
        expect(size.pixelHeight).toBe(Math.max(1, Math.floor(size.cssHeight * size.rasterScale)))
        expect(size.rasterScale).toBeLessThanOrEqual(2)
      }
    }
  })
  it('rejects_invalid_geometry', () => {
    for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
      expect(pdfRenderSizing(invalid, 800, 300, 1, 2)).toBeNull()
      expect(pdfRenderSizing(600, invalid, 300, 1, 2)).toBeNull()
      expect(pdfRenderSizing(600, 800, invalid, 1, 2)).toBeNull()
    }
    expect(pdfRenderSizing(Number.MAX_VALUE, 800, 300, 3, 2)).toBeNull()
    expect(pdfRenderSizing(1e200, 1e200, 300, 1, 2)).toBeNull()
  })
})
