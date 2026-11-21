import { existsSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server.node'
import { preload } from 'react-dom'
import { describe, expect, it } from 'vitest'
import baseline from '../test/fixtures/recovered-font-baseline.json'

const root = process.cwd()

describe('recovered local font delivery', () => {
  it.each([false, true])('emits exactly three real SSR preloads (equivalent prior hints: %s)', async (priorHints) => {
    expect(existsSync(path.join(root, 'src/components/common/FontPreloads.tsx'))).toBe(true)
    const componentPath = '../components/common/FontPreloads'
    const { FontPreloads } = await import(/* @vite-ignore */ componentPath)
    function Hints() {
      for (const href of baseline.latinPreloads) preload(href, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' })
      return null
    }
    const html = renderToStaticMarkup(<html><head>{priorHints && <Hints />}<FontPreloads /><FontPreloads /></head><body /></html>)
    const links = html.match(/<link\b[^>]*>/g) ?? []
    expect(links).toHaveLength(3)
    for (const [index, href] of baseline.latinPreloads.entries()) {
      expect(links[index]).toContain(`href="${href}"`)
      expect(links[index]).toContain('rel="preload"')
      expect(links[index]).toContain('as="font"')
      expect(links[index]).toContain('type="font/woff2"')
      expect(links[index]).toMatch(/crossorigin="(?:anonymous)?"/i)
    }
    expect(html.indexOf(links[2])).toBeLessThan(html.indexOf('</head>'))
  })
})
