import { useEffect, useRef, useState, type FormEvent } from 'react';
import * as Radix from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { asRequestNotDispatchedError, canDispatch, readTurnContext } from '@study/web-transport';
import { useNotebookConnection } from '../../data/use-notebook-connection';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { useNotebookCreationDrafts } from '../../app/WorkbenchSession';
export function CreateNotebookDialog({request = 0, hideTrigger = false}: {request?: number; hideTrigger?: boolean} = {}) {
    const { t, notebook: messages, session } = useI18n();
    const { api, context, ready } = useNotebookConnection();
    const navigate = useNavigate();
    const queries = useQueryClient();
    const [open, setOpen] = useState(false);
    const [participating, setParticipating] = useState(false);
    const { drafts, state, activate, navigationPending } = useNotebookCreationDrafts(participating);
    const active = state.active;
    const creation = active?.creation;
    const name = creation?.name ?? '';
    const description = creation?.description ?? '';
    const busy = creation?.status === 'pending';
    const outcome = creation?.status === 'unknown' ? 'unknown' : creation?.status === 'not-sent' ? 'not-sent' : null;
    const retiredCreations = state.retained;
    const setName = (value: string) => {
        if (active)
            drafts.editNotebookCreation(active.id, { name: value });
    };
    const setDescription = (value: string) => {
        if (active)
            drafts.editNotebookCreation(active.id, { description: value });
    };
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const retired = !!active && (active.retired || !context || active.id.epoch !== context.epoch);
    function changeOpen(value: boolean) {
        if (busy)
            return;
        if (value && context) {
            setParticipating(true);
            const id = drafts.openNotebookCreation(context);
            if (id)
                activate(id);
        }
        setOpen(value);
    }
    function startFreshForm() {
        const current = readTurnContext();
        if (!retired || !ready || !current?.ready)
            return;
        const id = drafts.startFreshNotebookCreation(current);
        if (id)
            activate(id);
    }
    async function submit(event: FormEvent) {
        event.preventDefault();
        if (!active || !api)
            return;
        const captured = drafts.beginNotebookCreation(active.id, readTurnContext());
        if (!captured)
            return;
        try {
            const created = await api.create({ name: captured.name.trim(), ...(captured.description.trim() ? { description: captured.description.trim() } : {}) }, captured.context);
            drafts.settleNotebookCreation(active.id, { notebookId: created.id }, readTurnContext());
            const settled = drafts.get(active.id)?.creation;
            if (settled?.status === 'succeeded')
                void queries.invalidateQueries({ queryKey: ['notebooks'] });
            const current = drafts.getNotebookCreationSnapshot().active;
            if (!mounted.current || current?.id !== active.id || current.creation.status !== 'succeeded' || !canDispatch(captured.context, readTurnContext()))
                return;
            setOpen(false);
            // A newer captured navigation owns the next route, even before its confirmation settles.
            if (navigationPending())
                return;
            void navigate(`/notebooks/${encodeURIComponent(created.id)}`);
        }
        catch (error) {
            drafts.settleNotebookCreation(active.id, asRequestNotDispatchedError(error) ? 'not-sent' : 'unknown', readTurnContext());
        }
    }
    useEffect(() => { if (request > 0) changeOpen(true); }, [request]);
    return <Radix.Root open={open} onOpenChange={changeOpen}>
        {!hideTrigger && <Radix.Trigger asChild><Button variant="primary" disabled={!ready}>{t.notebooks.newNotebook}</Button></Radix.Trigger>}
        <Radix.Portal>
            <Radix.Overlay className="dialog-overlay"/>
            <Radix.Content className="dialog-content" onEscapeKeyDown={event => {
            if (busy)
                event.preventDefault();
        }} onPointerDownOutside={event => {
            if (busy)
                event.preventDefault();
        }}>
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
                    {retiredCreations.map(record => <article key={record.id.editorSession}>
                        <dl><dt>{t.common.name}</dt><dd>{record.creation.name}</dd><dt>{t.common.description}</dt><dd>{record.creation.description}</dd></dl>
                        <p>{session.retiredDraft}</p>
                        {record.creation.status === 'unknown' && <p>{messages.createUnknown}</p>}
                    </article>)}
                </section>}
            </Radix.Content>
        </Radix.Portal>
    </Radix.Root>;
}
