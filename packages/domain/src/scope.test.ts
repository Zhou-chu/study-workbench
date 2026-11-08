import { expect, it } from 'vitest'
import { reduceScope, createScope } from './scope.js'
import { navigationDecision } from './navigation.js'
it('reading never changes the selected versions', () => {
  const state = createScope({ engine: 'independent', selection_origin: 'local', source_version_ids: ['old'], remote_source_ids: [] })
  expect(reduceScope(state, { type: 'read', sourceVersionId: 'new' })).toBe(state)
  const next = reduceScope(state, { type: 'select', selection: { ...state, source_version_ids: ['new'] } })
  expect(next.source_version_ids).toEqual(['new']); expect(state.source_version_ids).toEqual(['old'])
})
it('navigation blocks unresolved writes and confirms dirty target changes only', () => {
  expect(navigationDecision({ targetChanged: false, dirty: true, saving: false, unknown: false })).toBe('allow')
  expect(navigationDecision({ targetChanged: true, dirty: true, saving: false, unknown: false })).toBe('confirm')
  expect(navigationDecision({ targetChanged: true, dirty: false, saving: false, unknown: true })).toBe('blocked')
})
