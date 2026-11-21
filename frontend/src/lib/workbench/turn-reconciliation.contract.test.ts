import { describe, expectTypeOf, it } from 'vitest'
import type { EvidenceCitation, EvidenceRecord } from '@/lib/types/personal'

describe('read-only turn reconciliation', () => {
  it('types retained citation/evidence support metadata as nullable boolean, not corroboration proof', () => {
    expectTypeOf<EvidenceCitation['independent_support']>().toEqualTypeOf<boolean | null | undefined>()
    expectTypeOf<EvidenceRecord['independent_support']>().toEqualTypeOf<boolean | null | undefined>()
  })
})
