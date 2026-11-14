import { createHash, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sourceSnapshotKey } from './source-snapshot-key'
beforeEach(() => vi.stubGlobal('crypto', webcrypto))
afterEach(() => vi.unstubAllGlobals())
it('uses a versioned, bounded SHA-256 identity without sending note prose', async () => {
  const origin = { kind: 'note', id: 'note:资料', revision: 3 } as const
  const expected = createHash('sha256').update(JSON.stringify(['source-snapshot-v1', 'notebook:one', 'note', 'note:资料', 3])).digest('hex')
  const key = await sourceSnapshotKey('notebook:one', origin)
  expect(key).toBe('source-snapshot-v1:' + expected)
  expect(key.length).toBeLessThan(200)
  expect(await sourceSnapshotKey('notebook:one', origin)).toBe(key)
  expect(await sourceSnapshotKey('notebook:two', origin)).not.toBe(key)
  expect(await sourceSnapshotKey('notebook:one', { ...origin, revision: 4 })).not.toBe(key)
  expect(await sourceSnapshotKey('notebook:one', { kind: 'turn', id: origin.id })).not.toBe(key)
})
