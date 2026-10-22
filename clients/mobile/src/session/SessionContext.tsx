import { createContext, useContext, useSyncExternalStore } from 'react';
import type { FixtureSession } from './FixtureSession';
export const SessionContext = createContext<FixtureSession | null>(null);
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('Fixture session provider required');
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { session, state };
}
