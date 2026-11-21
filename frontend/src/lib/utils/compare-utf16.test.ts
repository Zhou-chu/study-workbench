import { describe, expect, it } from 'vitest'
import { compareUtf16 } from './compare-utf16'

describe('compareUtf16', () => {
  it('preserves identifier ordering by JavaScript UTF-16 code units, not numeric or locale collation', () => {
    const ids = ['\uE000', 'é', '2', 'a', 'e\u0301', '😀', 'A', '10', '10']
    expect([...ids].sort(compareUtf16)).toEqual(['10', '10', '2', 'A', 'a', 'e\u0301', 'é', '😀', '\uE000'])
  })

  it('preserves nullable identifiers and historical string coercion for malformed numeric JSON values', () => {
    const ids = ['null', 2, 10, '2', '10', null] as unknown as (string | null)[]
    expect([...ids].sort(compareUtf16)).toEqual([10, '10', 2, '2', 'null', null])
  })
})
