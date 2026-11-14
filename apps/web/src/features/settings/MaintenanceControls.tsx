import { useEffect, useRef, useState } from 'react';
import { asRequestNotDispatchedError } from '@study/web-transport';
import type { ReaderDetail } from '../../data/evidence-api';
import { SettingsRequestError } from '../../data/settings-api';
import { readerIsCurrent, type ReaderIntent } from '../reader/navigation';
import type { MaintenanceAttempt, RetrievalFence } from './retrieval-state';
import type { RetrievalController } from './use-retrieval';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';

export function MaintenanceControls({ control: c, detail, intent }: {
    control: RetrievalController; detail: ReaderDetail; intent: ReaderIntent;
}) {
    const { t, retrieval: m } = useI18n(), w = t.workbench;
    const [confirm, setConfirm] = useState<{ operation: 'reparse' | 'revalidate'; fence: RetrievalFence } | null>(null);
    const [busy, setBusy] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const summary = useRef<HTMLElement>(null);
    const collapse = () => { setExpanded(false); setConfirm(null); };
    const lifetime = useRef({ active: true, busy: false });
    useEffect(() => { lifetime.current.active = true; return () => { lifetime.current.active = false; }; }, []);
    const origin = detail.version.origin;
    const knownOrigin = typeof origin === 'string' && ['upload', 'pasted_text', 'derived_snapshot', 'web_snapshot'].includes(origin);
    const original = knownOrigin && detail.version.original_status === 'available';
    const canReparse = original || origin === 'web_snapshot' && detail.retainedMarkdown === true;
    const canRevalidate = original && detail.extraction?.verification_origin === 'restored_archive';
    const rows = c.s?.maintenance.filter(a => a.request.versionId === detail.version.source_version_id) ?? [];
    const blocked = () => c.owner.store.get(c.owner.row?.id ?? '')?.retrieval.maintenance.some(a =>
        a.request.versionId === detail.version.source_version_id &&
        (a.phase === 'pending' || a.phase === 'unknown' || a.observationFailed || a.job && ['queued', 'running', 'submission_unknown'].includes(a.job.state))) ?? true;
    const current = (f: RetrievalFence) => lifetime.current.active && readerIsCurrent(intent) &&
        detail.version.notebook_id === intent.notebookId && detail.version.source_version_id === intent.source_version_id && c.current(f, false);
    const patch = (id: string, patch: Partial<MaintenanceAttempt>) => c.update(s => ({
        ...s, maintenance: Object.freeze(s.maintenance.map(a => a.id === id ? Object.freeze({ ...a, ...patch }) : a)),
    }));
    const queue = (operation: 'reparse' | 'revalidate') => {
        const fence = c.capture();
        if (!fence || !current(fence) || blocked() || (operation === 'reparse' ? !canReparse : !canRevalidate)) return;
        setConfirm({ operation, fence });
    };
    const submit = async () => {
        const token = confirm, api = c.owner.api;
        if (!token || !api || !current(token.fence) || blocked() || lifetime.current.busy ||
            (token.operation === 'reparse' ? !canReparse : !canRevalidate)) return;
        lifetime.current.busy = true; setBusy(true); setConfirm(null);
        const request = Object.freeze({ notebookId: intent.notebookId, versionId: detail.version.source_version_id,
            extractionId: token.operation === 'revalidate' ? detail.extraction!.extraction_id : null,
            operation: token.operation, idempotency_key: crypto.randomUUID() });
        const attempt: MaintenanceAttempt = Object.freeze({ id: request.idempotency_key, readerKey: intent.key,
            fence: token.fence, request, phase: 'pending', job: null, observationFailed: false });
        c.update(s => ({ ...s, maintenance: Object.freeze([...s.maintenance, attempt]) }));
        try {
            if (!current(token.fence)) { patch(attempt.id, { phase: 'not-sent' }); return; }
            const job = await api.maintain(request, token.fence.context);
            patch(attempt.id, { phase: current(token.fence) ? 'acknowledged' : 'unknown', job });
        } catch (e) {
            patch(attempt.id, { phase: asRequestNotDispatchedError(e) ? 'not-sent' : 'unknown',
                ...(e instanceof SettingsRequestError ? { httpStatus: e.status } : {}) });
        } finally {
            lifetime.current.busy = false;
            if (lifetime.current.active) setBusy(false);
        }
    };
    const refresh = async (a: MaintenanceAttempt) => {
        if (!a.job || !c.owner.api || a.readerKey !== intent.key || !current(a.fence) || lifetime.current.busy) return;
        lifetime.current.busy = true; setBusy(true);
        try {
            const job = await c.owner.api.maintenanceJob(a.request, a.job, a.fence.context);
            if (current(a.fence)) patch(a.id, { job, observationFailed: false });
        } catch { patch(a.id, { observationFailed: true }); }
        finally { lifetime.current.busy = false; if (lifetime.current.active) setBusy(false); }
    };
    return <section className="maintenance-controls" aria-label={m.maintenanceTitle}>
        <details open={expanded} onKeyDown={event => { if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); collapse(); summary.current?.focus(); } }}>
        <summary ref={summary} onClick={event => { event.preventDefault(); if (expanded) collapse(); else setExpanded(true); }}>{m.maintenanceTitle}</summary>
        <div className="retrieval-panel" hidden={!expanded}>
        <p>{w.maintenanceMeaning}</p>
        {detail.retainedMarkdown === true && <p>{m.retainedMarkdown}</p>}
        {(!canReparse || !canRevalidate) && <p role="status">{w.unavailable}</p>}
        <div className="dialog-actions">
            <Button disabled={!c.ready || busy || blocked() || !canReparse} onClick={() => queue('reparse')}>{w.reparse}</Button>
            <Button disabled={!c.ready || busy || blocked() || !canRevalidate} onClick={() => queue('revalidate')}>{w.revalidate}</Button>
        </div>
        {confirm && <section><p className="source-id">{detail.version.source_version_id} · {confirm.operation === 'revalidate' ? detail.extraction?.extraction_id : ''}</p>
            <Button disabled={!current(confirm.fence) || busy} onClick={() => void submit()}>{t.common.confirm}</Button>
            <Button onClick={() => setConfirm(null)}>{t.common.cancel}</Button></section>}
        </div></details>
        {rows.map(a => <section key={a.id} className={a.phase === 'unknown' || a.observationFailed ? 'settings-danger' : 'operation-notice'}>
            <details><summary>{w.jobTechnicalDetails}</summary><p className="source-id">{a.id}</p>{a.job && <p className="source-id">{a.job.job_id}</p>}</details>
            <p role="status">{a.phase === 'pending' ? t.common.processing : a.phase === 'not-sent' ? t.noteConflict.notSent :
                a.phase === 'unknown' || a.observationFailed ? t.commandSubmission.warning :
                    w.states[a.job?.state as keyof typeof w.states] ?? t.common.unknown}</p>
            {a.httpStatus !== undefined && <p>{t.common.error}: {a.httpStatus}</p>}
            {a.job && <><p>{m.maintenanceRefreshWarning}</p>
                <Button disabled={a.readerKey !== intent.key || !current(a.fence) || busy}
                    onClick={() => void refresh(a)}>{m.maintenanceRefresh}</Button></>}
            {a.job?.result && ('checked_count' in a.job.result ?
                <p>{w.revalidationPartial.replace('{{checked}}', String(a.job.result.checked_count))
                    .replace('{{verified}}', String(a.job.result.verified_count)).replace('{{unverified}}', String(a.job.result.unverified_count))}</p> :
                <p>{w.reparseComplete} <span className="source-id">{a.job.result.extraction_id}</span></p>)}
        </section>)}
    </section>;
}
