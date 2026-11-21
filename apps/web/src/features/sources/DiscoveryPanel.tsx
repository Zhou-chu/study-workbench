import {SetupLink} from '../settings/SetupLink';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import { canDispatch, freezeDispatchContext, readTurnContext, sessionCoordinator, type DispatchContext } from '@study/web-transport';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { safeSourceUrl, type WebResults, type WebStatus, type WebResult } from '../../data/source-api';
import { useSourceOperations } from './use-source-operations';
import { ConfirmSourceAction } from './ConfirmSourceAction';
type ImportIntent = {
    context: DispatchContext;
    generation: number;
    results: readonly WebResult[];
};
export function DiscoveryPanel({ notebookId, onChanged }: {
    notebookId: string;
    onChanged: () => void;
}) {
    const { t } = useI18n(), m = t.webDiscovery;
    const ops = useSourceOperations(notebookId, onChanged);
    const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [status, setStatus] = useState<WebStatus | null>(null), [results, setResults] = useState<WebResults | null>(null), [selected, setSelected] = useState<string[]>([]), [confirmation, setConfirmation] = useState<ImportIntent | null>(null), [busy, setBusy] = useState(false), [importing, setImporting] = useState(false), [error, setError] = useState(false), [stopped, setStopped] = useState(false);
    const active = useRef(true), sequence = useRef(0), composing = useRef(false), flight = useRef(false), queue = useRef<{
        stopped: boolean;
    } | null>(null);
    const capability = useRef<{
        context: DispatchContext;
        generation: number;
    } | null>(null);
    useEffect(() => { active.current = true; return () => { active.current = false; sequence.current++; if (queue.current)
        queue.current.stopped = true; }; }, []);
    const current = (c: DispatchContext, g: number) => active.current && canDispatch(c, readTurnContext()) && g === sessionCoordinator.current();
    const ready = ops.ready && status?.state === 'ready' && status.configured && !!capability.current && current(capability.current.context, capability.current.generation);
    const check = async () => { const c = readTurnContext(); if (!ops.api || !ops.ready || !c?.ready || flight.current)
        return; flight.current = true; setBusy(true); setError(false); const g = sessionCoordinator.current(); try {
        const value = await ops.api.webStatus(c);
        if (current(c, g)) {
            capability.current = { context: freezeDispatchContext(c), generation: g };
            setStatus(value);
        }
    }
    catch {
        setError(true);
    }
    finally {
        flight.current = false;
        if (active.current)
            setBusy(false);
    } };
    const search = async () => { const c = readTurnContext(); if (!ops.api || !ready || !c?.ready || composing.current || flight.current || !query.trim())
        return; flight.current = true; setBusy(true); setError(false); const own = ++sequence.current, g = sessionCoordinator.current(); setResults(null); setSelected([]); try {
        const value = await ops.api.searchWeb(query.trim(), Math.min(6, status!.max_results), c);
        if (current(c, g) && own === sequence.current)
            setResults(value);
    }
    catch {
        if (own === sequence.current)
            setError(true);
    }
    finally {
        flight.current = false;
        if (active.current)
            setBusy(false);
    } };
    const confirm = async () => { const captured = confirmation; setConfirmation(null); if (!captured || !ready || !current(captured.context, captured.generation))
        return; const batch = { stopped: false }; queue.current = batch; setImporting(true); setStopped(false); for (const result of captured.results) {
        if (batch.stopped || !current(captured.context, captured.generation))
            break;
        const id = ops.store.capture(notebookId, { kind: 'web', result }, captured.context, captured.generation);
        await ops.run(id, () => !batch.stopped && current(captured.context, captured.generation));
    } if (active.current)
        setImporting(false); if (queue.current === batch)
        queue.current = null; };
    return <><Button onClick={() => setOpen(true)}>{m.title}</Button><Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content"><div className="dialog-heading"><Dialog.Title>{m.title}</Dialog.Title><Dialog.Close asChild><Button>{m.close}</Button></Dialog.Close></div><Dialog.Description>{m.description}</Dialog.Description><p>{status?.access_mode === 'keyless_trial' ? m.trialPrivacy : m.privacyNotice}</p>{status?.access_mode === 'keyless_trial' && <p>{m.trialQuota}</p>}<Button disabled={!ops.ready || busy} onClick={() => { void check(); }}>{m.retryStatus}</Button>{status?.state === 'configuration_required' && <p>{m.configurationRequired} <SetupLink className="record-link" to="/settings#web-search">{m.openSettings}</SetupLink></p>}<form onSubmit={e => { e.preventDefault(); void search(); }}><label>{m.queryLabel}<input value={query} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={e => { if (e.key === 'Enter' && (e.nativeEvent.isComposing || composing.current))
        e.preventDefault(); }} onChange={e => { sequence.current++; setQuery(e.target.value); setResults(null); setSelected([]); }}/></label><Button type="submit" disabled={!ready || busy || !query.trim()}>{m.search}</Button></form>{error && <p role="alert">{m.errors.generic}</p>}{results && <><p className="meta">{results.provider} · <time>{results.searched_at}</time></p><p>{m.unverifiedNotice}</p><ul>{results.results.map(r => <li key={r.id}><label className="source-check"><input type="checkbox" aria-label={r.title} checked={selected.includes(r.id)} disabled={!ready || !selected.includes(r.id) && selected.length >= 5} onChange={e => setSelected(e.target.checked ? [...selected, r.id] : selected.filter(id => id !== r.id))}/>{r.title}</label><p>{r.snippet}</p>{safeSourceUrl(r.url) && <a className="record-link" href={safeSourceUrl(r.url)} target="_blank" rel="noopener noreferrer">{r.domain}</a>}</li>)}</ul><p>{m.selectionLimit}</p><Button disabled={!ready || !selected.length || importing} onClick={() => { const c = readTurnContext(); if (c?.ready)
        setConfirmation({ context: freezeDispatchContext(c), generation: sessionCoordinator.current(), results: results.results.filter(r => selected.includes(r.id)).map(r => Object.freeze({ ...r })) }); }}>{m.importSelected.replace('{{count}}', String(selected.length))}</Button></>}{importing && <Button onClick={() => { if (queue.current)
        queue.current.stopped = true; setStopped(true); }}>{m.cancel}</Button>}{stopped && <p role="status">{m.cancelled}</p>}</Dialog.Content></Dialog.Portal></Dialog.Root><ConfirmSourceAction open={!!confirmation} title={m.title} description={m.privacyNotice} disabled={!ready || !confirmation || !current(confirmation.context, confirmation.generation)} onConfirm={() => { void confirm(); }} onCancel={() => setConfirmation(null)}><p className="source-id">{notebookId}</p><ul>{confirmation?.results.map(r => <li key={r.id}>{r.title}<p className="source-id">{r.url}</p></li>)}</ul></ConfirmSourceAction></>;
}
