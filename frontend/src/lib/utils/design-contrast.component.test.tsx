import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { SetupBanner } from '@/components/layout/SetupBanner'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'

vi.mock('@/lib/hooks/use-credentials', () => ({ useCredentialStatus: () => ({ data: { encryption_configured: false, source: {} } }), useEnvStatus: () => ({ data: {} }) }))
import { Button } from '@/components/ui/button'
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

import { theme, contrast, utilityColor } from '@/test/design-contrast-fixture'

describe.each([false, true])('enabled semantic text contrast (dark=%s)', dark => {
  const color = theme(dark)
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
})
