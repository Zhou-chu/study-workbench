import type { ObservedTurnState } from '@study/contracts';
import { useI18n } from '../../i18n';
import { StatusBadge } from '../../ui/StatusBadge';
export function TurnStatus({ state, posting = false }: {
    state: ObservedTurnState;
    posting?: boolean;
}) { const { t } = useI18n(); const label = posting ? t.common.loading : state === 'unknown' ? t.common.unknown : t.workbench.states[state]; return <div role="status"><StatusBadge state={state === 'failed' ? 'error' : state === 'succeeded' ? 'success' : state === 'unknown' || state === 'submission_unknown' ? 'unknown' : 'pending'} label={label}/></div>; }
