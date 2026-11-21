import { expectTypeOf, it } from 'vitest'
import type { EvidenceCitation } from '@study/contracts'

it('types retained citation/evidence support metadata as nullable boolean, not corroboration proof', () => {
  expectTypeOf<EvidenceCitation['independent_support']>().toEqualTypeOf<boolean | null | undefined>()
})
