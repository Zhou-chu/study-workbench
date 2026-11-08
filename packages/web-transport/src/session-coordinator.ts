export type AuthPhase = 'bootstrapping' | 'pending' | 'authenticated' | 'refresh-needed' | 'reauth-required' | 'unavailable' | 'anonymous'
export type RecoveryPhase = Extract<AuthPhase, 'pending' | 'refresh-needed' | 'reauth-required' | 'unavailable'>

/** Browser coordination contains only operation generations, never credentials.
 * BFF singleflight owns refresh correctness; Web Locks/storage are not required.
 */
export function createSessionCoordinator() {
  let generation = 0
  let resourceEpoch = 0
  let evidenceRevision = 0
  let phase: AuthPhase | null = null
  const listeners = new Set<(phase: RecoveryPhase) => void>()
  return {
    begin: () => { resourceEpoch++; return ++generation },
    current: () => resourceEpoch,
    evidence: () => evidenceRevision,
    confirmed: () => { resourceEpoch++; evidenceRevision++ },
    setPhase: (value: AuthPhase) => { phase = value },
    resourcePhase: () => phase,
    isCurrent: (candidate: number) => candidate === generation,
    subscribe(listener: (phase: RecoveryPhase) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    report(phase: RecoveryPhase, dispatchedGeneration: number) {
      if (dispatchedGeneration === resourceEpoch) { evidenceRevision++; listeners.forEach(listener => listener(phase)) }
    },
  }
}
export const sessionCoordinator = createSessionCoordinator()
