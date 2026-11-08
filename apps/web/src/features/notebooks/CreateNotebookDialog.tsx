import { useEffect, useRef, useState } from 'react';
import * as Radix from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { asRequestNotDispatchedError, canDispatch, freezeDispatchContext, type DispatchContext } from '@study/web-transport';
import { useNotebookConnection } from '../../data/use-notebook-connection';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
export function CreateNotebookDialog() {
    const { t, notebook: messages, session } = useI18n();
    const { api, context, ready } = useNotebookConnection();
    const navigate = useNavigate();
    const queries = useQueryClient();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [busy, setBusy] = useState(false);
    const [outcome, setOutcome] = useState<'unknown' | 'not-sent' | null>(null);
    const capture = useRef<DispatchContext | null>(null);
    const latch = useRef(false);
    const uncertain = useRef(false);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const retired = !!capture.current && !!context && capture.current.epoch !== context.epoch;
    function changeOpen(value: boolean) { if (busy)
        return; if (value && !capture.current && context)
        capture.current = freezeDispatchContext(context); setOpen(value); }
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        const captured = capture.current;
        if (latch.current || uncertain.current || !name.trim() || !api || !captured || !canDispatch(captured, context) || outcome === 'unknown')
            return;
        latch.current = true;
        setBusy(true);
        setOutcome(null);
        try {
            const created = await api.create({ name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) }, captured);
            if (!mounted.current)
                return;
            void queries.invalidateQueries({ queryKey: ['notebooks'] });
            setOpen(false);
            setName('');
            setDescription('');
            capture.current = null;
            void navigate(`/notebooks/${encodeURIComponent(created.id)}`);
        }
        catch (error) {
            uncertain.current = !asRequestNotDispatchedError(error);
            if (mounted.current)
                setOutcome(uncertain.current ? 'unknown' : 'not-sent');
        }
        finally {
            latch.current = false;
            if (mounted.current)
                setBusy(false);
        }
    }
    return <Radix.Root open={open} onOpenChange={changeOpen}><Radix.Trigger asChild><Button variant="primary" disabled={!ready}>{t.notebooks.newNotebook}</Button></Radix.Trigger><Radix.Portal><Radix.Overlay className="dialog-overlay"/><Radix.Content className="dialog-content" onEscapeKeyDown={event => { if (busy)
        event.preventDefault(); }} onPointerDownOutside={event => { if (busy)
        event.preventDefault(); }}><Radix.Title>{t.notebooks.createNew}</Radix.Title><Radix.Description>{t.notebooks.createNewDesc}</Radix.Description><form onSubmit={event => { void submit(event); }}><label className="field-label" htmlFor="notebook-name">{t.common.name}</label><input id="notebook-name" autoComplete="off" value={name} onChange={event => setName(event.target.value)} required readOnly={retired || busy || outcome === 'unknown'}/><label className="field-label" htmlFor="notebook-description">{t.common.description} ({t.common.optional})</label><textarea id="notebook-description" value={description} onChange={event => setDescription(event.target.value)} readOnly={retired || busy || outcome === 'unknown'}/>{retired && <p role="status">{session.retiredDraft}</p>}{outcome && <p role="alert">{outcome === 'unknown' ? messages.createUnknown : messages.createNotSent}</p>}<div className="dialog-actions"><Button type="button" disabled={busy} onClick={() => changeOpen(false)}>{t.common.cancel}</Button><Button type="submit" variant="primary" disabled={!ready || retired || busy || !name.trim() || outcome === 'unknown'}>{busy ? t.common.creating : t.common.create}</Button></div></form></Radix.Content></Radix.Portal></Radix.Root>;
}
