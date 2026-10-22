import React, { useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { FixtureSession } from './session/FixtureSession';
import { SessionContext } from './session/SessionContext';
import { WorkspaceNavigator } from './navigation/WorkspaceNavigator';
/** Pass a session only for an explicit embedding lifetime or deterministic tests. */
export default function App({session: supplied}: {session?: FixtureSession}) {
  const [session] = useState(() => supplied ?? new FixtureSession());
  return <SessionContext.Provider value={session}><SafeAreaProvider>
    <SafeAreaView edges={['bottom', 'left', 'right']} style={{flex: 1}}><WorkspaceNavigator /></SafeAreaView>
  </SafeAreaProvider></SessionContext.Provider>;
}
