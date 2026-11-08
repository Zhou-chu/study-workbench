import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';
export function studioStateLabel(state: string, t: ReturnType<typeof useI18n>['t']): string { const known: Record<string, string> = { ...t.workbench.states, idle: t.workbench.states.pending, accepted: t.workbench.states.pending, submitting: t.common.loading, saving: t.common.loading, saved: t.workbench.states.succeeded, unknown: t.common.unknown, conflict: t.noteConflict.conflict, rejected: t.noteConflict.rejected }; return Object.hasOwn(known, state) ? known[state]! : `${t.common.unknown} (${state})`; }
export function ArtifactCard({ title, state, children }: {
    title: string;
    state?: string;
    children?: ReactNode;
}) { const { t } = useI18n(); return <article className="artifact-card"><h3>{title}</h3>{state && <p>{t.workbench.submissionStatus.replace('{{status}}', studioStateLabel(state, t))}</p>}{children}</article>; }
