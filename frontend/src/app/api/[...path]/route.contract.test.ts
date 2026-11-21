import { describe, expect, it } from 'vitest'
import * as resource from './route'
import * as auth from '../auth/[...path]/route'
import * as ask from '../search/ask/route'
import * as portable from '../personal/imports/portable/route'

describe('explicit Node route handlers', () => {
  it('exports all methods so Next cannot synthesize protected HEAD/OPTIONS behavior', () => {
    for (const handlers of [resource, auth, ask, portable]) {
      expect(handlers.runtime).toBe('nodejs')
      expect(handlers.dynamic).toBe('force-dynamic')
      for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) expect(handlers[method]).toBeTypeOf('function')
    }
  })
})
