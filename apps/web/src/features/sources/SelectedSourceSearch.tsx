import { readySources } from '../chat/chat-admission';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { canDispatch, freezeDispatchContext, readTurnContext, sessionCoordinator, subscribeTurnContext, type DispatchContext } from '@study/web-transport';
import type { WorkspaceViewV1, WorkbenchSelection } from '@study/contracts';
import type { EvidenceResults } from '../../data/source-api';
import { useSourceConnection } from '../../data/use-source-connection';
import { useAppDrafts } from '../../app/providers';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import type { SourceReadIntent } from './source-selection';
type Capture = {
    context: DispatchContext;
    session: number;
    sequence: number;
    fingerprint: string;
};
export function SelectedSourceSearch({ notebookId, selection, workspace, disabled, onRead }: {
    notebookId: string;
    selection: WorkbenchSelection | null;
    workspace: WorkspaceViewV1;
    disabled: boolean;
    onRead: (i: SourceReadIntent) => void;
}) {
    const { t } = useI18n(), connection = useSourceConnection(), drafts = useAppDrafts(), client = useQueryClient();
    const [query, setQuery] = useState(''), [result, setResult] = useState<{
        capture: Capture;
        data: EvidenceResults;
    } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(false);
    const sequence = useRef(0), composing = useRef(false), pending = useRef(false), mounted = useRef(true);
    const fingerprint = JSON.stringify([notebookId, selection?.engine, selection?.selection_origin, selection?.source_version_ids, selection?.remote_source_ids, workspace.sources, disabled]);
    const latest = useRef(fingerprint);
    if (latest.current !== fingerprint) {
        latest.current = fingerprint;
        sequence.current++;
    }
    useEffect(() => {
        mounted.current = true;
        let active = true;
        const invalidate = () => {
            // Cache entries can be created by another component during render.
            // Retire reads immediately, but publish React state only after that stack ends.
            const invalidatedSequence = ++sequence.current;
            const epoch = readTurnContext()?.epoch;
            const session = sessionCoordinator.current();
            queueMicrotask(() => {
                if (active && mounted.current && sequence.current === invalidatedSequence
                    && readTurnContext()?.epoch === epoch && sessionCoordinator.current() === session)
                    setResult(null);
            });
        };
        const a = subscribeTurnContext(invalidate);
        const b = drafts.sources.subscribe(invalidate);
        const c = client.getQueryCache().subscribe(e => {
            if (e.query.queryKey[0] === 'workspace' && e.query.queryKey.at(-1) === notebookId)
                invalidate();
        });
        return () => { active = false; mounted.current = false; sequence.current++; a(); b(); c(); };
    }, [drafts, client, notebookId]);
    const valid = (c: Capture) => mounted.current && c.sequence === sequence.current && c.fingerprint === latest.current && c.session === sessionCoordinator.current() && canDispatch(c.context, readTurnContext());
    const ready = connection.ready && !disabled && selection?.selection_origin === 'local' && readySources(workspace, selection.source_version_ids);
    const search = async () => { const c = readTurnContext(); if (!ready || !selection || !connection.api || !c?.ready || composing.current || pending.current || !query.trim())
        return; pending.current = true; setBusy(true); setError(false); setResult(null); const capture: Capture = { context: freezeDispatchContext(c), session: sessionCoordinator.current(), sequence: ++sequence.current, fingerprint: latest.current }; try {
        const data = await connection.api.searchEvidence(notebookId, query.trim(), [...selection.source_version_ids], capture.context);
        if (valid(capture))
            setResult({ capture, data });
    }
    catch {
        if (valid(capture))
            setError(true);
    }
    finally {
        pending.current = false;
        if (mounted.current)
            setBusy(false);
    } };
    const visible = result && valid(result.capture) ? result : null;
    return <section className="selected-search"><form onSubmit={e => { e.preventDefault(); void search(); }}><label>{t.workbench.searchSelectedSources}<input value={query} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={e => { if (e.key === 'Enter' && (e.nativeEvent.isComposing || composing.current))
        e.preventDefault(); }} onChange={e => { sequence.current++; setQuery(e.target.value); setResult(null); }}/></label><Button type="submit" disabled={!ready || busy || !query.trim()}>{t.workbench.searchEvidence}</Button></form>{!ready && <p>{t.workbench.searchSelectLocal}</p>}{busy && <p role="status">{t.workbench.searchLoading}</p>}{error && <p role="alert">{t.workbench.searchFailed}</p>}{visible && <><p>{t.workbench.searchResults}</p>{visible.data.retrieval && <dl><dt>{t.workbench.retrievalMode}</dt><dd>{visible.data.retrieval.retrieval_method === 'hybrid' ? t.workbench.hybridMode : ['lexical', 'lexical_fallback'].includes(visible.data.retrieval.retrieval_method) ? t.workbench.lexicalOnly : t.common.unknown}</dd><dt>{t.workbench.selectedVersions}</dt><dd>{visible.data.retrieval.selected_version_count}</dd><dt>{t.workbench.retrievalCoverage.replace('{{indexed}}', String(visible.data.retrieval.indexed_version_count)).replace('{{selected}}', String(visible.data.retrieval.selected_version_count))}</dt>{visible.data.retrieval.fallback_reason && <dd>{t.workbench.retrievalFallback.replace('{{reason}}', visible.data.retrieval.fallback_reason === 'FEATURE_DISABLED' ? t.workbench.hybridDisabled : visible.data.retrieval.fallback_reason === 'PROFILE_UNAVAILABLE' ? t.workbench.chooseEmbeddingProfile : ['INDEX_NOT_READY', 'INDEX_STALE'].includes(visible.data.retrieval.fallback_reason) ? t.workbench.semanticNotReady : visible.data.retrieval.fallback_reason === 'EMBEDDING_OUTCOME_UNKNOWN' ? t.workbench.unknownSubmission : t.common.unknown)}</dd>}</dl>}<ul>{visible.data.hits.map((hit, index) => <li key={hit.evidence_id}><p>{hit.quote}</p><Button aria-label={`${t.workbench.read} ${index + 1}`} onClick={() => { if (valid(visible.capture))
        onRead({ source_version_id: hit.source_version_id, evidence_id: hit.evidence_id, ...(hit.page_index !== undefined ? { page_index: hit.page_index } : {}) }); }}>{t.workbench.read}</Button></li>)}</ul>{!visible.data.hits.length && <p>{t.workbench.searchNoResults}</p>}</>}</section>;
}
