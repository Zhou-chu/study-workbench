import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import { calc } from '@csstools/css-calc'

const css = postcss.parse(readFileSync(path.resolve('src/app/globals.css'), 'utf8'))
export function matchesWorkbenchMedia(query: string, width: number, coarse = false, initialFontSize = 16) {
  const termMatches = (term: string) => {
    const bounded = term.match(/^\((min|max)-width:\s*([\d.]+)(px|rem)\)$/)
    if (bounded) {
      const bound = Number(bounded[2]) * (bounded[3] === 'rem' ? initialFontSize : 1)
      if (!Number.isFinite(bound)) throw new Error(`Unsupported media query: ${term}`)
      return bounded[1] === 'min' ? width >= bound : width <= bound
    }
    // Tailwind emits range syntax for its own rem breakpoints.
    const range = term.match(/^\(width\s*(>=|<=|>|<)\s*([\d.]+)(px|rem)\)$/)
    if (range) {
      const bound = Number(range[2]) * (range[3] === 'rem' ? initialFontSize : 1)
      if (!Number.isFinite(bound)) throw new Error(`Unsupported media query: ${term}`)
      return range[1] === '>=' ? width >= bound : range[1] === '<=' ? width <= bound : range[1] === '>' ? width > bound : width < bound
    }
    const pointer = term.match(/^\(pointer:\s*(coarse|fine)\)$/)
    if (pointer) return pointer[1] === 'coarse' ? coarse : !coarse
    throw new Error(`Unsupported media query: ${term}`)
  }
  // Parse every alternative before combining: an already-true phone branch
  // must not hide an unsupported condition in the coarse-pointer branch.
  return query.split(',').map(branch => branch.trim().split(/\s+and\s+/).map(termMatches).every(Boolean)).some(Boolean)
}
// Deliberately limited to authored workspace rules. This tests the responsive
// constraints and selector coverage, not layout, cascade integration or pixels.
export function workbenchRules(element: Element, width: number, coarse = false, initialFontSize = 16, pseudo = '') {
  const result: Record<string, string> = {}
  css.walkRules(rule => {
    if (!rule.selector.includes('workbench-')) return
    let active = true
    for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
      if (parent.type === 'atrule' && parent.name === 'media') {
        active = matchesWorkbenchMedia(parent.params, width, coarse, initialFontSize) && active
      }
    }
    const selector = pseudo ? rule.selector.endsWith(pseudo) ? rule.selector.slice(0, -pseudo.length) : null : rule.selector.includes('::') ? null : rule.selector
    if (active && selector && element.matches(selector)) rule.walkDecls(decl => { result[decl.prop] = decl.value })
  })
  return result
}
export function lengthPixels(value: string | undefined, containing: number, initialFontSize = 16) {
  if (!value) return NaN
  return Number.parseFloat(calc(value.replace(/([\d.]+)%/g, (_, n) => `${Number(n) * containing / 100}px`).replace(/([\d.]+)rem/g, (_, n) => `${Number(n) * initialFontSize}px`)))
}
