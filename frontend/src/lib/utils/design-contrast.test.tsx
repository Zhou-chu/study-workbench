import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { SetupBanner } from '@/components/layout/SetupBanner'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'

vi.mock('@/lib/hooks/use-credentials', () => ({ useCredentialStatus: () => ({ data: { encryption_configured: false, source: {} } }), useEnvStatus: () => ({ data: {} }) }))
import { Button, buttonVariants } from '@/components/ui/button'
import { workbenchRules } from '@/test/workbench-css'
import { useForm, type Control, type FieldValues } from 'react-hook-form'
import { SourceTypeStep } from '@/components/sources/steps/SourceTypeStep'
import { WizardContainer } from '@/components/ui/wizard-container'

type SourceFields = Parameters<typeof SourceTypeStep>[0]['control'] extends Control<infer Fields extends FieldValues> ? Fields : never
function SourceValidationFixture() {
  const form = useForm<SourceFields>({ defaultValues: { type: 'link', url: 'invalid URL', embed: false, async_processing: true } })
  return <WizardContainer currentStep={1} steps={[]}>
    <SourceTypeStep control={form.control} register={form.register} setValue={form.setValue} errors={{}} urlValidationErrors={[{ line: 7, url: 'invalid URL' }]} />
  </WizardContainer>
}

// Source math, not browser/computed-style evidence. Resolve the actual aliases;
// composite encoded sRGB before linearizing it for relative luminance.
const css = postcss.parse(readFileSync(path.resolve('src/app/globals.css'), 'utf8'))
type RGB = [number, number, number]
function theme(dark: boolean) {
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
const mix = (fg: RGB, bg: RGB, opacity: number): RGB => fg.map((value, i) => value * opacity + bg[i] * (1 - opacity)) as RGB
const luminance = (rgb: RGB) => rgb.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
const contrast = (a: RGB, b: RGB) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
const surfaces = ['background', 'sidebar', 'card', 'popover', 'muted', 'accent']
function utilityColor(classes: string, prefix: string, color: ReturnType<typeof theme>, bg: RGB): RGB {
  const utility = classes.split(' ').reverse().find(value => value.startsWith(prefix))
  if (!utility) throw new Error(`Missing ${prefix} in ${classes}`)
  const [name, alpha] = utility.slice(prefix.length).split('/')
  const foreground = name === 'white' ? [1, 1, 1] as RGB : color(name)
  return mix(foreground, bg, alpha ? Number(alpha) / 100 : 1)
}

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
  it('keeps the actual classic importer line label readable through both nested danger washes over its wizard card', () => {
    render(createElement(SourceValidationFixture))
    const chip = screen.getByText('sources.lineLabel')
    const outer = chip.closest('.bg-destructive\\/10')!
    const card = chip.closest('.bg-card')!
    expect(card).not.toBeNull()
    expect(outer).not.toBeNull()
    expect(screen.getByText('invalid URL')).toBeVisible()
    const cardFill = utilityColor(card.className, 'bg-', color, color('background'))
    const outerFill = utilityColor(outer.className, 'bg-', color, cardFill)
    const chipFill = utilityColor(chip.className, 'bg-', color, outerFill)
    // Font-size utilities are not colors. Read the actual nearest semantic ink,
    // including inherited list-item ink, rather than assume a passing token.
    let inkOwner: Element | null = chip
    while (inkOwner && !/\btext-(foreground|destructive)\b/.test(inkOwner.className)) inkOwner = inkOwner.parentElement
    expect(inkOwner).not.toBeNull()
    const ink = utilityColor(inkOwner!.className, 'text-', color, chipFill)
    expect(contrast(ink, chipFill), `line label on nested alpha/card (dark=${dark})`).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps the setup documentation action readable on its danger tint while hovered', () => {
    render(createElement(SetupBanner))
    const action = screen.getByRole('link', { name: 'setupBanner.viewDocs' })
    const bg = color('destructive-tint')
    const ink = utilityColor(action.className, 'hover:text-', color, bg)
    expect(contrast(ink, bg)).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps the focused destructive menu text readable after its alpha fill is composited', () => {
    render(createElement(DropdownMenu, { open: true },
      createElement(DropdownMenuTrigger, null, 'Menu'),
      createElement(DropdownMenuContent, null, createElement(DropdownMenuItem, { variant: 'destructive' }, 'Delete'))))
    const item = screen.getByRole('menuitem', { name: 'Delete' })
    const prefix = dark && item.className.includes('dark:data-[variant=destructive]:focus:bg-') ? 'dark:data-[variant=destructive]:focus:bg-' : 'data-[variant=destructive]:focus:bg-'
    const fill = utilityColor(item.className, prefix, color, color('popover'))
    expect(contrast(color('destructive'), fill)).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps the persistent neutral tab marker at least3:1 against selected and surrounding tab fills', () => {
    render(createElement(Button, { className: 'workbench-region-tab', variant: 'secondary', role: 'tab', 'aria-selected': true }, 'Selected region'))
    const marker = workbenchRules(screen.getByRole('tab'), 390, false, 16, '::after')
    const token = marker['background-color']?.match(/^var\(--([\w-]+)\)$/)?.[1]
    expect(token).toBeDefined()
    expect(contrast(color(token!), color('secondary'))).toBeGreaterThanOrEqual(3)
    expect(contrast(color(token!), color('muted'))).toBeGreaterThanOrEqual(3)
  })
  it.each(surfaces)('opaque focus ring token is at least 3:1 against %s', surface => {
    expect(contrast(color('ring'), color(surface))).toBeGreaterThanOrEqual(3)
  })
})
