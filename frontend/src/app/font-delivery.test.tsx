import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import baseline from '../test/fixtures/recovered-font-baseline.json'

const root = process.cwd()
const read = (name: string) => readFileSync(path.join(root, name), 'utf8')

describe('recovered local font delivery', () => {
  it('removes Google build acquisition and preserves the body font variables', () => {
    const layout = read('src/app/layout.tsx')
    expect(layout).not.toContain('next/font/google')
    expect(layout).toContain('import "./fonts.css"')
    expect(layout).toContain('<FontPreloads />')
    expect(layout).toContain('className="app-fonts font-sans"')
  })
  it('ships all seven exact recovered bytes without alteration', () => {
    for (const font of baseline.fonts) {
      const file = path.join(root, 'public/fonts', font.file)
      expect(existsSync(file), font.file).toBe(true)
      const bytes = readFileSync(file)
      expect(bytes.length).toBe(font.size)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(font.sha256)
    }
  })
  it('includes complete hash-pinned family OFL notices', () => {
    for (const license of baseline.licenses) {
      const file = path.join(root, 'public/fonts', license.file)
      expect(existsSync(file)).toBe(true)
      const bytes = readFileSync(file)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(license.sha256)
      expect(bytes.toString()).toContain('SIL OPEN FONT LICENSE Version 1.1')
      expect(bytes.toString()).toContain('OTHER DEALINGS IN THE FONT SOFTWARE.')
    }
  })
  it('preserves every real/subset face and fallback metric, not a naive local array', () => {
    expect(existsSync(path.join(root, 'src/app/fonts.css'))).toBe(true)
    const css = read('src/app/fonts.css')
    expect(css.match(/@font-face\s*\{[^}]+\}/g)).toEqual(baseline.faces)
    expect(baseline.faces).toHaveLength(13)
    expect(css).not.toMatch(/https?:|fonts\.google/)
    for (const variable of ['--font-instrument-sans', '--font-bricolage', '--font-spline-mono']) {
      expect(css).toContain(variable)
    }
  })
  it('keeps the independent global error document free of normal-layout preloads', () => {
    // No application global-error currently exists; Next supplies its independent document.
    const error = existsSync(path.join(root, 'src/app/global-error.tsx')) ? read('src/app/global-error.tsx') : ''
    expect(error).not.toMatch(/FontPreloads|fonts\.css|next\/font/)
  })
})
