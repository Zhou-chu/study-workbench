import { FreshLibraryIntent } from './FreshLibraryIntent';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { useStudio } from '../studio/use-studio';
import { useClassicContext } from './use-classic-context';
import { NativeChatPanel } from './NativeChatPanel';
export function ContextMode({ label, value, onChange, notes = false, disabled = false, bulk = false }: {
    label: string;
    value: string;
    onChange(v: string): void;
    notes?: boolean;
    disabled?: boolean;
    bulk?: boolean;
}) {
    const { native: n, t } = useI18n();
    return <label className="classic-context-mode">{label}<select aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>{bulk && <option value="">{t.common.actions}</option>}<option value="not in">{n.off}</option>{!notes && <option value="insights">{n.insights}</option>}<option value="full content">{n.full}</option></select></label>;
}
export function ClassicNotebookPanel({ notebookId }: {
    notebookId: string;
}) {
    const c = useClassicContext(notebookId), s = useStudio(notebookId), { native: n, t } = useI18n(), [preview, setPreview] = useState<{
        revision: number;
        value: unknown;
    } | null>(null), [failed, setFailed] = useState(false), [busy, setBusy] = useState(false), ticket = useRef(0);
    const notes = useQuery({ queryKey: ['library', 'classic-context-notes', c.scope, notebookId], enabled: s.ready && c.ready, queryFn: () => s.api!.listClassic(notebookId, c.context!) });
    const revision = c.row?.revision;
    useEffect(() => () => { ticket.current++; }, []);
    async function inspect() {
        if (!c.api || !c.context || busy)
            return;
        const current = ++ticket.current, captured = c.row;
        setBusy(true);
        setFailed(false);
        try {
            const value = await c.api.context({ kind: 'notebook', notebookId }, c.config, c.context);
            if (ticket.current === current && captured && captured.revision === c.store.get(captured.id)?.revision)
                setPreview({ revision: captured.revision, value });
        }
        catch {
            if (ticket.current === current)
                setFailed(true);
        }
        finally {
            if (ticket.current === current)
                setBusy(false);
        }
    }
    return <><section className="classic-context" aria-label={n.preview}><ContextMode label={n.bulkNotes} value="" notes bulk disabled={c.locked || !notes.data?.length} onChange={mode => c.change('notes', (notes.data ?? []).map(v => v.id), mode)}/>{notes.data?.map(note => <ContextMode key={note.id} label={n.noteContext + ' · ' + (note.title || note.id)} notes value={c.config.notes[note.id] ?? 'not in'} disabled={c.locked} onChange={mode => c.change('notes', [note.id], mode)}/>)}{notes.isError && <p role="alert">{t.common.contentUnavailable.errorTitle}</p>}<Button disabled={c.locked || busy} onClick={() => void inspect()}>{n.preview}</Button>{failed && <p role="alert">{t.common.contentUnavailable.errorTitle}</p>}{preview !== null && preview.revision === revision && <details key={revision} open><summary>{n.preview}</summary><pre>{JSON.stringify(preview.value, null, 2)}</pre></details>}</section><FreshLibraryIntent row={c.row} input={{ kind: 'classic-context', parent: { kind: 'notebook', notebookId }, config: { sources: {}, notes: {} } }} onFresh={c.onFresh}/><NativeChatPanel parent={{ kind: 'notebook', notebookId }} config={c.config}/></>;
}
