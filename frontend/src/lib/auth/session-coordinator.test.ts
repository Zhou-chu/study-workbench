import { describe, expect, it } from 'vitest'
import { createSessionCoordinator } from './session-coordinator'
describe('metadata-only operation coordination', () => {
  it('only allows the latest started operation to publish', () => {
    const coordinator = createSessionCoordinator()
    const earlier = coordinator.begin(); const newer = coordinator.begin()
    expect(coordinator.isCurrent(earlier)).toBe(false)
    expect(coordinator.isCurrent(newer)).toBe(true)
    expect(JSON.stringify(coordinator)).not.toMatch(/password|access_token|refresh_token/)
  })
  it('ignores a late resource failure after a new login or signout', () => {
    const coordinator = createSessionCoordinator(); const phases: string[] = []
    coordinator.subscribe(phase => phases.push(phase))
    const dispatched = coordinator.current(); coordinator.begin()
    coordinator.report('reauth-required', dispatched)
    expect(phases).toEqual([])
    coordinator.report('refresh-needed', coordinator.current())
    expect(phases).toEqual(['refresh-needed'])
  })
})
