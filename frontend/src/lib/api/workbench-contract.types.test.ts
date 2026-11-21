import { expectTypeOf, it } from 'vitest'
import { workbenchApi } from './workbench'
import type { TurnContext } from '@/lib/workbench/turn-context'
import type { TurnRequest, TurnSubmissionResponse } from '@/lib/types/personal'

it('keeps turn and recovery DTO signatures at the type boundary', () => {
  expectTypeOf<Awaited<ReturnType<typeof workbenchApi.turn>>>().toEqualTypeOf<TurnSubmissionResponse>()
  expectTypeOf<TurnRequest>().not.toHaveProperty('reading')
  expectTypeOf<Parameters<typeof workbenchApi.turn>[2]>().toEqualTypeOf<TurnContext | undefined>()
  expectTypeOf<Parameters<typeof workbenchApi.workspace>[1]>().toEqualTypeOf<TurnContext | undefined>()
  expectTypeOf<Parameters<typeof workbenchApi.turns>[1]>().toEqualTypeOf<TurnContext | undefined>()
  expectTypeOf<Awaited<ReturnType<typeof workbenchApi.turn>>['dispatch_receipt']>().toEqualTypeOf<unknown>()
})
