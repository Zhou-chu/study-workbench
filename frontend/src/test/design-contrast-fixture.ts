import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'

// Source math, not browser/computed-style evidence. Resolve the actual aliases;
// composite encoded sRGB before linearizing it for relative luminance.
const css = postcss.parse(readFileSync(path.resolve('src/app/globals.css'), 'utf8'))
type RGB = [number, number, number]
export function theme(dark: boolean) {
  const vars: Record<string, string> = {}
  for (const selector of ['@theme', ':root', ...(dark ? ['.dark'] : [])]) {
    css.walkDecls(decl => {
      const parent = decl.parent
      if ((selector === '@theme' && parent?.type === 'atrule' && parent.name === 'theme') || (parent?.type === 'rule' && parent.selector === selector)) vars[decl.prop] = decl.value
    })
  }
  const resolve = (value: string, seen: string[] = []): string => value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    if (seen.includes(name) || !vars[name]) throw new Error(`Unresolved/cyclic token ${name}`)
    return resolve(vars[name], [...seen, name])
  })
  return (name: string): RGB => {
    const hex = resolve(`var(--color-${name})`)
    if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Unsupported color ${name}: ${hex}`)
    return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255) as RGB
  }
}
export const mix = (fg: RGB, bg: RGB, opacity: number): RGB => fg.map((value, i) => value * opacity + bg[i] * (1 - opacity)) as RGB
const luminance = (rgb: RGB) => rgb.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
export const contrast = (a: RGB, b: RGB) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
export function utilityColor(classes: string, prefix: string, color: ReturnType<typeof theme>, bg: RGB): RGB {
  const utility = classes.split(' ').reverse().find(value => value.startsWith(prefix))
  if (!utility) throw new Error(`Missing ${prefix} in ${classes}`)
  const [name, alpha] = utility.slice(prefix.length).split('/')
  const foreground = name === 'white' ? [1, 1, 1] as RGB : color(name)
  return mix(foreground, bg, alpha ? Number(alpha) / 100 : 1)
}
