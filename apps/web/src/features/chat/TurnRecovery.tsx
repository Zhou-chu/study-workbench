import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import type { ConversationSnapshot } from './turn-runtime';
import { TurnStatus } from './TurnStatus';
export function TurnRecovery({ snapshot, canCheck, canRetry, onCheck, onRetry, onAbandon, onStop }: {
    snapshot: ConversationSnapshot;
    canCheck: boolean;
    canRetry: boolean;
    onCheck(): void;
    onRetry(): void;
    onAbandon(): void;
    onStop(): void;
}) {
    const { t, source } = useI18n(), op = snapshot.operation;
    if (!op)
        return null;
    return <article className="chat-message chat-recovery" aria-label={t.workbench.turnRecoveryTitle}><p className="chat-question">{op.capture.dto.message}</p><TurnStatus state={snapshot.stage} posting={op.busy === 'post'}/><p>{snapshot.retired ? source.retired : t.workbench.turnRecoveryUncertain}</p>{op.receipt && <p>{t.workbench.turnRecoveryCheckOnly}</p>}{op.busy === 'check' && <p role="status">{t.workbench.turnRecoveryChecking}</p>}
 <Button disabled={!canCheck || !!op.busy} onClick={onCheck}>{t.workbench.turnRecoveryCheck}</Button>
 {op.phase === 'not-sent' && <>{!canRetry && <p>{t.workbench.turnRecoveryTargetChanged}</p>}<Button disabled={!canRetry || !!op.busy} onClick={onRetry}>{t.workbench.turnRecoveryRetry}</Button><Button disabled={!!op.busy} onClick={onAbandon}>{t.workbench.turnRecoveryAbandon}</Button><p>{t.workbench.turnRecoveryRetryWarning}</p></>}
 {snapshot.waiting && <Button onClick={onStop}>{t.workbench.cancelWaiting}</Button>}<p>{t.workbench.remoteMayContinue}</p>
 <details><summary>{t.workbench.turnRecoveryOriginal}</summary><p>{op.capture.dto.engine}</p><ul>{[...op.capture.dto.source_version_ids, ...op.capture.dto.remote_source_ids].map((id, i) => <li key={i}>{id}</li>)}</ul></details></article>;
}
