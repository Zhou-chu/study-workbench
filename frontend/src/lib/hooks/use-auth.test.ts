import { expect, it, vi } from 'vitest'
vi.unmock('@/lib/hooks/use-auth')
import { safeReturnPath } from './use-auth'
it.each(['//outside.example', 'https://outside.example', '/\\outside.example', '/%5coutside.example', '/%2foutside.example', '/\n/outside.example', '/%0a/outside.example'])('rejects unsafe login return path %s', path => { expect(safeReturnPath(path)).toBe('/notebooks') })
it('keeps a relative protected route and query', () => { expect(safeReturnPath('/notebooks/fixture?view=notes')).toBe('/notebooks/fixture?view=notes') })
