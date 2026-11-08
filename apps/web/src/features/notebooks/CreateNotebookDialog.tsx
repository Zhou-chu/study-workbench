import { useEffect, useRef, useState, type FormEvent } from 'react';
import * as Radix from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { asRequestNotDispatchedError, canDispatch, freezeDispatchContext, readTurnContext, type DispatchContext } from '@study/web-transport';
import { useNotebookConnection } from '../../data/use-notebook-connection';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';

type CreationOutcome = 'unknown' | 'not-sent' | null;
type CreationIntent = {
    readonly id: string;
    readonly context: DispatchContext;
    latch: boolean;
    uncertain: boolean;
};
type RetiredCreation = Readonly<{
    intent: CreationIntent;
    name: string;
    description: string;
    outcome: CreationOutcome;
    retired: true;
}>;
const freshIntent = (context: DispatchContext): CreationIntent => ({
    id: crypto.randomUUID(), context: freezeDispatchContext(context), latch: false, uncertain: false,
});

export function CreateNotebookDialog() {
    const { t, notebook: messages, session } = useI18n();
    const { api, context, ready } = useNotebookConnection();
    const navigate = useNavigate();
    const queries = useQueryClient();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [busy, setBusy] = useState(false);
    const [outcome, setOutcome] = useState<CreationOutcome>(null);
    const [retiredCreations, setRetiredCreations] = useState<readonly RetiredCreation[]>([]);
    const activeIntent = useRef<CreationIntent | null>(null);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const retired = !!activeIntent.current && (!context || activeIntent.current.context.epoch !== context.epoch);

    function changeOpen(value: boolean) {
        if (busy) return;
        if (value && !activeIntent.current && context) activeIntent.current = freshIntent(context);
        setOpen(value);
    }
    function startFreshForm() {
        const previous = activeIntent.current;
        const current = readTurnContext();
        if (!previous || !retired || !ready || !current?.ready || previous.context.epoch === current.epoch) return;
        // A submitted retired attempt stays check-only even if its response is still pending.
        if (previous.latch) previous.uncertain = true;
        setRetiredCreations(records => [...records, Object.freeze({
            intent: previous, name, description, retired: true as const,
            outcome: previous.uncertain ? 'unknown' : outcome,
        })]);
        // This is a separate blank intent. Nothing is copied and the old lock/capture is retained.
        activeIntent.current = freshIntent(current);
        setName('');
        setDescription('');
        setOutcome(null);
        setBusy(false);
    }
    async function submit(event: FormEvent) {
        event.preventDefault();
        const intent = activeIntent.current;
        if (!intent || intent.latch || intent.uncertain || !name.trim() || !api || !canDispatch(intent.context, readTurnContext())) return;
        intent.latch = true;
        setBusy(true);
        setOutcome(null);
        try {
            const created = await api.create({ name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) }, intent.context);
            if (!mounted.current || activeIntent.current !== intent) return;
            if (!canDispatch(intent.context, readTurnContext())) {
                intent.uncertain = true;
                setOutcome('unknown');
                return;
            }
            void queries.invalidateQueries({ queryKey: ['notebooks'] });
            setOpen(false);
            setBusy(false);
            setName('');
            setDescription('');
            activeIntent.current = null;
            void navigate(`/notebooks/${encodeURIComponent(created.id)}`);
        } catch (error) {
            // The uncertainty lock belongs to this exact intent and is never cleared by a new form.
            intent.uncertain = intent.uncertain || !asRequestNotDispatchedError(error);
            if (mounted.current && activeIntent.current === intent) setOutcome(intent.uncertain ? 'unknown' : 'not-sent');
        } finally {
            intent.latch = false;
            if (mounted.current && activeIntent.current === intent) setBusy(false);
        }
    }
    return <Radix.Root open={open} onOpenChange={changeOpen}>
        <Radix.Trigger asChild><Button variant="primary" disabled={!ready}>{t.notebooks.newNotebook}</Button></Radix.Trigger>
        <Radix.Portal>
            <Radix.Overlay className="dialog-overlay"/>
            <Radix.Content className="dialog-content" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
                <Radix.Title>{t.notebooks.createNew}</Radix.Title>
                <Radix.Description>{t.notebooks.createNewDesc}</Radix.Description>
                <form onSubmit={event => { void submit(event); }}>
                    <label className="field-label" htmlFor="notebook-name">{t.common.name}</label>
                    <input id="notebook-name" autoComplete="off" value={name} onChange={event => setName(event.target.value)} required readOnly={retired || busy || outcome === 'unknown'}/>
                    <label className="field-label" htmlFor="notebook-description">{t.common.description} ({t.common.optional})</label>
                    <textarea id="notebook-description" value={description} onChange={event => setDescription(event.target.value)} readOnly={retired || busy || outcome === 'unknown'}/>
                    {retired && <div>
                        <p role="status">{session.retiredDraft}</p>
                        <p>{messages.freshCreationHint}</p>
                        <Button type="button" disabled={!ready} onClick={startFreshForm}>{messages.freshCreation}</Button>
                    </div>}
                    {outcome && <p role="alert">{outcome === 'unknown' ? messages.createUnknown : messages.createNotSent}</p>}
                    <div className="dialog-actions">
                        <Button type="button" disabled={busy} onClick={() => changeOpen(false)}>{t.common.cancel}</Button>
                        <Button type="submit" variant="primary" disabled={!ready || retired || busy || !name.trim() || outcome === 'unknown'}>{busy ? t.common.creating : t.common.create}</Button>
                    </div>
                </form>
                {retiredCreations.length > 0 && <section aria-label={messages.retainedCreations}>
                    <h3>{messages.retainedCreations}</h3>
                    {retiredCreations.map(record => <article key={record.intent.id}>
                        <dl><dt>{t.common.name}</dt><dd>{record.name}</dd><dt>{t.common.description}</dt><dd>{record.description}</dd></dl>
                        <p>{session.retiredDraft}</p>
                        {record.outcome === 'unknown' && <p>{messages.createUnknown}</p>}
                    </article>)}
                </section>}
            </Radix.Content>
        </Radix.Portal>
    </Radix.Root>;
}
