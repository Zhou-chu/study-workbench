import {useRef} from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { disclosure } from '../../data/retrieval-contracts';
import type { RetrievalController } from './use-retrieval';
export function RetrievalPanel({ control: c }: { control: RetrievalController }) {
    const { t, retrieval: m } = useI18n(), w = t.workbench, s = c.s;
    const previewButton = useRef<HTMLButtonElement>(null);
    if (!s) return null;
    const lifecycle = (value: string) => w.states[value as keyof typeof w.states] ?? t.common.unknown + ': ' + value;
    return <fieldset className="retrieval-panel" aria-label={w.semanticIndex}>
        <legend>{w.semanticIndex}</legend>
        <p>{w.indexExtractionSeparate}</p>
        <div className="dialog-actions">
            <label><input type="radio" name="retrieval-mode" checked={s.mode === 'lexical'} disabled={!c.ready}
                onChange={() => c.chooseMode('lexical')} />{w.lexicalOnly}</label>
            <label><input type="radio" name="retrieval-mode" checked={s.mode === 'hybrid'} disabled={!c.ready}
                onChange={() => c.chooseMode('hybrid')} />{w.hybridMode}</label>
        </div>
        <p>{m.refreshWarning}</p>
        <Button disabled={!c.ready || !c.local || s.busy} onClick={() => void c.refresh()}>{w.refreshIndexStatus}</Button>
        {s.busy && <p role="status">{t.common.processing}</p>}
        {s.error && <p role="alert">{w.semanticActionFailed}{s.httpStatus === undefined ? '' : ': ' + s.httpStatus}</p>}
        <label className="field-label">{w.embeddingProfile}
            <select aria-label={w.embeddingProfile} value={s.profileId ?? ''} disabled={!c.ready || !s.status || s.busy}
                onChange={e => c.chooseProfile(e.target.value)}>
                <option value="">{w.chooseEmbeddingProfile}</option>
                {s.profileId && !s.status?.profiles.some(p => p.profile.profile_id === s.profileId) &&
                    <option value={s.profileId} disabled>{t.common.unknown}: {s.profileId}</option>}
                {s.status?.profiles.map(p => <option key={p.profile.profile_id} value={p.profile.profile_id} disabled={!p.recognized || !disclosure(p.profile)}>
                    {p.profile.profile_id} · {p.profile.model_name}{!p.recognized && ' · ' + t.common.unknown + ': ' + p.state}{disclosure(p.profile) ? '' : ' · ' + t.common.unknown + ': ' + p.profile.destination_kind}
                </option>)}
            </select>
        </label>
        {s.status?.enabled === false && <p role="status">{w.hybridDisabled}</p>}
        {c.profile && <section>
            <p>{w.embeddingModelIdentity}: {c.profile.provider} · {c.profile.model_name} · {c.profile.model_id}</p>
            <p>{w.embeddingRevision}: {c.profile.revision}</p>
            <p>{w.embeddingDestination.replace('{{kind}}', c.profile.destination_kind === 'on_device' ? w.destination_on_device :
                c.profile.destination_kind === 'remote' ? w.destination_remote : c.profile.destination_kind === 'unknown' ? w.destination_unknown :
                    t.common.unknown + ': ' + c.profile.destination_kind).replace('{{version}}', c.profile.destination_descriptor_version)}</p>
            <p className="source-id">{c.profile.endpoint}</p>
            <details><summary>{w.originalEmbeddingDisclosure}</summary><pre className="source-id">{JSON.stringify(c.profile, null, 2)}</pre></details>
            <p>{!c.profileStatus?.recognized ? t.common.unknown + ': ' + c.profileStatus?.state :
                c.profileStatus.state === 'ready' ? w.semanticReady : w.semanticNotReady}</p>
            <details><summary>{w.jobTechnicalDetails}</summary><p className="source-id">{s.status?.profiles.find(p => p.profile === c.profile)?.state}</p></details>
        </section>}
        <label><input type="checkbox" checked={!!s.query} disabled={!c.semanticReady || s.busy}
            onChange={e => c.query(e.target.checked)} />{w.ackQueryProcessing}</label>
        {s.mode === 'hybrid' && <p>{w.hybridQueryUnavailable} {w.hybridOutlineUnavailable}</p>}
        <Button ref={previewButton} disabled={!c.semanticReady || c.locked} onClick={() => void c.preview()}>{w.previewIndex}</Button>
        {s.preview && <section>
            <p>{w.indexCounts.replace('{{evidence}}', String(s.preview.evidence_count)).replace('{{bytes}}', String(s.preview.input_bytes))}</p>
            <p>{w.documentQuerySeparate}</p>
            <p className="source-id">{s.preview.preview_hash}</p>
            <label><input type="checkbox" checked={s.documentAck} disabled={!c.ready || s.busy || s.attempts.some(a => a.phase === 'pending')}
                onChange={e => c.acknowledge('documentAck', e.target.checked)} />{w.ackDocumentProcessing}</label>
            {s.retryChild && <label><input type="checkbox" checked={s.duplicateAck} disabled={!c.ready || s.busy}
                onChange={e => c.acknowledge('duplicateAck', e.target.checked)} />{w.ackDuplicateCost}</label>}
            <div className="dialog-actions">
                <Button disabled={!c.semanticReady || s.busy || !s.documentAck || !!s.retryChild && !s.duplicateAck ||
                    s.attempts.some(a => ['pending', 'unknown'].includes(a.phase)) || !s.retryChild && c.locked}
                    onClick={() => void c.build()}>{w.confirmIndex}</Button>
                <Button disabled={!c.ready} onClick={() => { c.cancelPreview(); previewButton.current?.focus(); }}>{w.cancelIndexPreview}</Button>
            </div>
        </section>}
        {s.attempts.map(a => <section key={a.id} className={a.phase === 'unknown' || a.observationFailed ? 'settings-danger' : 'operation-notice'}>
            <h3>{w.indexReceipt}</h3><p className="source-id">{a.id}</p>
            <p role="status">{a.phase === 'pending' ? w.indexSubmitting : a.phase === 'not-sent' ? t.noteConflict.notSent :
                a.phase === 'unknown' || a.observationFailed ? w.indexUnknown : lifecycle((a.observedReceipt ?? a.receipt)?.state ?? '')}
                {a.httpStatus === undefined ? '' : ': ' + a.httpStatus}</p>
            {a.phase === 'unknown' && <><p>{w.indexRecoveryWarning}</p>
                <Button disabled={!c.current(a.fence) || !c.semanticReady || s.busy || !s.preview || !s.documentAck}
                    onClick={() => void c.build(a.id)}>{w.recoverIndexSubmission}</Button></>}
            {a.receipt && <><p>{w.indexJobsNotReadiness}</p><p>{m.cancelWarning}</p>
                <Button variant="danger" disabled={!c.current(a.fence, false) || s.busy}
                    onClick={() => void c.cancel(a.id, a.receipt!.group_id)}>{w.cancelWaiting}</Button>
                {a.receipt.jobs.map(j => {
                    const observed = a.children.find(v => v.job_id === j.job_id);
                    const visible = observed ?? j;
                    return <div key={j.job_id}>
                        <p className="source-id">{j.job_id}</p><p className="source-id">{j.source_version_id}</p>
                        <p>{w.indexJobProgress.replace('{{state}}', lifecycle(visible.state)).replace('{{stage}}', t.common.processing)
                            .replace('{{completed}}', String(visible.completed_evidence)).replace('{{total}}', String(visible.total_evidence))}</p>
                        <Button variant="danger" disabled={!c.current(a.fence, false) || s.busy}
                            onClick={() => void c.cancel(a.id, j.job_id)}>{w.cancelWaiting} · {j.job_id}</Button>
                        <Button disabled={!observed || !['failed', 'submission_unknown', 'cancelled_local'].includes(observed.state) ||
                            !c.current(a.fence, false) || !c.semanticReady || s.busy}
                            onClick={() => void c.preview(j.job_id)}>{w.retryFullVersion} · {j.job_id}</Button>
                    </div>;
                })}
            </>}
        </section>)}
        {s.maintenance.map(a => <section key={a.id} className={a.phase === 'unknown' || a.observationFailed ? 'settings-danger' : 'operation-notice'}>
            <h3>{a.request.operation === 'reparse' ? w.reparse : w.revalidate}</h3>
            <p>{w.maintenanceMeaning}</p>
            <p className="source-id">{a.id}</p>
            <p className="source-id">{a.request.versionId}</p>
            {a.request.extractionId && <p className="source-id">{a.request.extractionId}</p>}
            <p role="status">{a.phase === 'pending' ? t.common.processing : a.phase === 'not-sent' ? t.noteConflict.notSent :
                a.phase === 'unknown' || a.observationFailed ? t.commandSubmission.warning : lifecycle(a.job?.state ?? '')}</p>
            {a.httpStatus !== undefined && <p>{t.common.error}: {a.httpStatus}</p>}
            {a.job && <p className="source-id">{a.job.job_id}</p>}
        </section>)}
    </fieldset>;
}
