import * as Dialog from '@radix-ui/react-dialog';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { useSourceOperations } from './use-source-operations';
import { useState } from 'react';
export function AddSourceDialog({ notebookId, sourceId, open, onClose, onChanged }: {
    notebookId: string;
    sourceId?: string;
    open: boolean;
    onClose: () => void;
    onChanged: () => void;
}) {
    const { source: m, t } = useI18n();
    const operations = useSourceOperations(notebookId, onChanged);
    const [ids, setIds] = useState<string[]>([]), [error, setError] = useState(false);
    const selected = ids.map(id => operations.store.get(id));
    const canSubmit = operations.ready && selected.some(r => r && !r.retired && r.operation.state === 'idle' && r.file);
    return <Dialog.Root open={open} onOpenChange={v => { if (!v)
        onClose(); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content"><div className="dialog-heading"><Dialog.Title>{sourceId ? t.workbench.uploadVersion : m.add}</Dialog.Title><Dialog.Close asChild><Button>{t.common.close}</Button></Dialog.Close></div><Dialog.Description>{t.workbench.noSources}</Dialog.Description><p className="meta">{m.fileLimit}: {operations.maxBytes ?? t.common.unknown} B</p>{sourceId && <p className="source-id">{sourceId}</p>}<label className="file-picker">{m.choose}<input aria-label={m.choose} type="file" accept=".pdf,.md,.txt,application/pdf,text/markdown,text/plain" multiple disabled={!operations.ready} onChange={async (e) => { const files = Array.from(e.target.files ?? []), c = readTurnContext(); if (!c?.ready || operations.maxBytes === undefined)
        return; const valid = files.filter(f => /\.(pdf|md|txt)$/i.test(f.name) && f.size <= operations.maxBytes!); setError(valid.length !== files.length); const generation = sessionCoordinator.current(); try {
        setIds(await Promise.all(valid.map(file => operations.store.captureUpload(notebookId, file, c, generation, sourceId))));
    }
    catch {
        setError(true);
    } }}/></label>{error && <p role="alert">{t.workbench.uploadFailed} · {m.fileLimit}: {operations.maxBytes} B</p>}<ul>{selected.map(r => r && <li key={r.id}>{r.file?.name ?? m.missingFile}{r.operation.state === 'succeeded' && <p>{m.accepted}</p>}{r.retired && <p>{m.retired}</p>}{r.operation.state === 'unknown' && <p>{m.checkOnly}</p>}</li>)}</ul><Button disabled={!canSubmit} onClick={() => { for (const id of ids)
        void operations.run(id); }}>{m.upload}</Button></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
