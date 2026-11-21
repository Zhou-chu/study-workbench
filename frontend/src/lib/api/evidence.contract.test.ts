import { expectTypeOf, it } from 'vitest'
import { evidenceApi } from './evidence'
import type { TurnContext } from '@/lib/workbench/turn-context'

it('keeps the captured evidence context optional at the type boundary', () => {
  expectTypeOf<Parameters<typeof evidenceApi.search>[2]>().toEqualTypeOf<TurnContext | undefined>()
})
