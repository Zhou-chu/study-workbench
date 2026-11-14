import * as Dialog from '@radix-ui/react-dialog';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { canDispatch, freezeDispatchContext, readTurnContext, sessionCoordinator, type DispatchContext } from '@study/web-transport';
import { useSourceOperations } from './use-source-operations';
import { useEffect, useRef, useState } from 'react';
type PickerToken = Readonly<{ revision: number; notebookId: string; sourceId: string | undefined; context: DispatchContext; generation: number }>;
export function AddSourceDialog({ notebookId, sourceId, open, onClose, onChanged }: {
    notebookId: string;
    sourceId?: string;
    open: boolean;
    onClose: () => void;
    onChanged: () => void;
}) {
    const { source: m, t } = useI18n();
    const operations = useSourceOperations(notebookId, onChanged);
    const [choice, setChoice] = useState<{ token: PickerToken; ids: string[] } | null>(null);
    const [hashing, setHashing] = useState(false), [error, setError] = useState(false);
    const picker = useRef<PickerToken | null>(null), revision = useRef(0), mounted = useRef(true);
    const latest = useRef({ open, notebookId, sourceId });
    latest.current = { open, notebookId, sourceId };
    const generation = sessionCoordinator.current();
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; picker.current = null; }; }, []);
    useEffect(() => {
        picker.current = null;
        revision.current++;
        setChoice(null);
        setHashing(false);
        return () => { picker.current = null; revision.current++; };
    }, [open, notebookId, sourceId, operations.context, generation]);
    const valid = (token: PickerToken) => mounted.current && picker.current === token && latest.current.open && latest.current.notebookId === token.notebookId && latest.current.sourceId === token.sourceId && canDispatch(token.context, readTurnContext()) && token.generation === sessionCoordinator.current();
    const selected = choice && valid(choice.token) ? choice.ids.map(id => operations.store.get(id)) : [];
    const canSubmit = !hashing && operations.ready && selected.some(row => row && !row.retired && row.operation.state === 'idle' && row.file);
    const choose = async (files: File[]) => {
        // Invalidate synchronously, before hashing or a second click can use the previous choice.
        picker.current = null;
        revision.current++;
        setChoice(null);
        setHashing(false);
        setError(false);
        const context = readTurnContext();
        if (!context?.ready || operations.maxBytes === undefined) return;
        const token: PickerToken = Object.freeze({ revision: revision.current, notebookId, sourceId, context: freezeDispatchContext(context), generation: sessionCoordinator.current() });
        picker.current = token;
        const filesWithinLimits = files.filter(file => /\.(pdf|md|txt)$/i.test(file.name) && file.size <= operations.maxBytes!);
        setError(filesWithinLimits.length !== files.length);
        if (!filesWithinLimits.length) return;
        setHashing(true);
        try {
            const ids = await Promise.all(filesWithinLimits.map(file => operations.store.captureUpload(token.notebookId, file, token.context, token.generation, token.sourceId)));
            if (valid(token)) setChoice({ token, ids });
        } catch {
            if (valid(token)) setError(true);
        } finally {
            if (valid(token)) setHashing(false);
        }
    };
    const submit = () => {
        if (!choice || hashing || !valid(choice.token)) return;
        for (const id of choice.ids) void operations.run(id);
    };
    return <Dialog.Root open={open} onOpenChange={v => { if (!v)
        onClose(); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content"><div className="dialog-heading"><Dialog.Title>{sourceId ? t.workbench.uploadVersion : m.add}</Dialog.Title><Dialog.Close asChild><Button>{t.common.close}</Button></Dialog.Close></div><Dialog.Description>{t.workbench.noSources}</Dialog.Description><p className="meta">{m.fileLimit}: {operations.maxBytes ?? t.common.unknown} B</p>{sourceId && <p className="source-id">{sourceId}</p>}<label className="file-picker">{m.choose}<input aria-label={m.choose} type="file" accept=".pdf,.md,.txt,application/pdf,text/markdown,text/plain" multiple disabled={!operations.ready} onChange={e => { void choose(Array.from(e.target.files ?? [])); }}/></label>{error && <p role="alert">{t.workbench.uploadFailed} · {m.fileLimit}: {operations.maxBytes} B</p>}<ul>{selected.map(r => r && <li key={r.id}>{r.file?.name ?? m.missingFile}{r.operation.state === 'succeeded' && <p>{m.accepted}</p>}{r.retired && <p>{m.retired}</p>}{r.operation.state === 'unknown' && <p>{m.checkOnly}</p>}</li>)}</ul><Button disabled={!canSubmit} onClick={submit}>{m.upload}</Button></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
