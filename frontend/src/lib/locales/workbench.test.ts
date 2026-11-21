import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { workbenchEn, workbenchZh } from './workbench'

describe('canonical workbench messages', () => {
  it('preserves every English and Chinese message and its ordered dictionary path', () => {
    const digest = (value: typeof workbenchEn) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex')

    expect(digest(workbenchEn)).toBe('ef6a4052dc75f34a2f8eb1ad075af74c8d8df7e7a0b2f39c540179c0afb122c8')
    expect(digest(workbenchZh)).toBe('70da22e51287b92dd843acaffc9a31f3619ea1ae2c40eb78caae4889ea72c22b')
  })
})
