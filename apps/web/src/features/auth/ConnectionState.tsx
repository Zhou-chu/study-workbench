import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { StatusBadge } from '../../ui/StatusBadge';
import type { SessionController, SessionSnapshot } from './session';
export function ConnectionState({ controller, state }: {
    controller: SessionController;
    state: SessionSnapshot;
}) {
    const { session } = useI18n();
    const issue = state.issue === 'invalid-password' ? null : state.issue;
    return <section className="connection-state" aria-live="polite"><StatusBadge state={issue ? 'warning' : 'pending'} label={issue ? session[issue] : session.pending}/><p>{session.memoryHint}</p>{state.phase !== 'bootstrapping' && issue !== 'google' && <Button disabled={state.busy} onClick={() => { void (state.phase === 'refresh-needed' ? controller.refresh() : controller.check()); }}>{session.check}</Button>}</section>;
}
