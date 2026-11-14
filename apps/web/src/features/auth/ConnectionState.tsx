import {useState} from 'react';
import type {NavigationController} from '../../app/drafts';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { StatusBadge } from '../../ui/StatusBadge';
import type { SessionController, SessionSnapshot } from './session';
export function ConnectionState({ controller, state, navigation }: {
    navigation?:NavigationController;
    controller: SessionController;
    state: SessionSnapshot;
}) {
    const [updateBlocked,setUpdateBlocked]=useState(false);
    const { session, t } = useI18n();
    const provider = state.ready && state.providerNeedsReauth;
    const issue = state.issue === 'invalid-password' ? null : state.issue;
    return <section className="connection-state" aria-live="polite"><StatusBadge state={provider || issue ? 'warning' : 'pending'} label={provider ? session.google : issue ? session[issue] : session.pending}/><p>{session.memoryHint}</p>{!state.ready && state.hasWorkspace && <p>{session.compatibilityPaused}</p>}{updateBlocked && <p role="status">{session.updateBlocked}</p>}{state.phase !== 'bootstrapping' && <Button disabled={state.busy || state.providerChecking} onClick={() => { void (provider ? controller.verifyProviderConnection() : state.phase === 'refresh-needed' ? controller.refresh() : controller.check()); }}>{provider ? session.verifyGoogle : state.phase === 'pending' ? t.auth.finishSignIn : session.check}</Button>}{!state.ready && navigation && <Button disabled={state.busy} onClick={()=>setUpdateBlocked(!navigation.requestUpdate(()=>window.location.reload()))}>{session.updateApplication}</Button>}<Button disabled={state.busy} onClick={()=>void controller.signoutLocal()}>{t.common.signOut}</Button></section>;
}
