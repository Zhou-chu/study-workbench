import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('root document turn owner', () => {
  it('is nested inside I18nProvider and outside ConnectionGuard in the actual root layout', () => {
    const layout = readFileSync('src/app/layout.tsx', 'utf8')
    expect(layout).toMatch(/<I18nProvider>\s*<TurnOperationProvider>\s*<ConnectionGuard>/)
    expect(layout).toMatch(/<\/ConnectionGuard>\s*<\/TurnOperationProvider>\s*<\/I18nProvider>/)
  })
})
