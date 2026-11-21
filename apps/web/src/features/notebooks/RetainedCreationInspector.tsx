import { useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { useAppDrafts } from '../../app/providers';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { LibraryDialog } from '../library/LibraryDialog';
export function RetainedCreationInspector() {
    const drafts = useAppDrafts(), snapshot = useSyncExternalStore(drafts.subscribe, drafts.getNotebookCreationSnapshot), [open, setOpen] = useState(false), { t, notebook, library: l, session } = useI18n();
    const rows = [...(snapshot.active ? [snapshot.active] : []), ...snapshot.retained];
    if (!rows.length)
        return null;
    return <><Button onClick={() => setOpen(true)}>{l.inspectCreations}</Button><LibraryDialog open={open} onOpenChange={setOpen} title={l.inspectCreations}>
 {rows.map(row => <article key={row.id.editorSession}><dl><dt>{t.common.name}</dt><dd>{row.creation.name}</dd><dt>{t.common.description}</dt><dd>{row.creation.description}</dd></dl><p>{row.creation.status === 'unknown' ? notebook.createUnknown : row.creation.status === 'pending' ? t.common.creating : row.creation.status === 'not-sent' ? notebook.createNotSent : row.creation.status === 'succeeded' ? t.common.completed : session.unsavedHint}</p>{row.retired && <p>{session.retiredDraft}</p>}{row.creation.notebookId && !row.retired && <Link className="button" to={'/notebooks/' + encodeURIComponent(row.creation.notebookId)}>{t.common.notebook}</Link>}</article>)}
 </LibraryDialog></>;
}
