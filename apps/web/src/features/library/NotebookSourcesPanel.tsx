import { useState } from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { SourceList } from './SourceList';
import { SourceImportDialog } from './SourceImportDialog';
import { AddExistingSourcesDialog } from './AddExistingSourcesDialog';
export function NotebookSourcesPanel({ notebookId }: {
    notebookId: string;
}) {
    const [open, setOpen] = useState(true), { library: l } = useI18n();
    return <section className="classic-sources" aria-label={l.classicSources}><h3>{l.classicSources}</h3><Button aria-expanded={open} aria-label={l.classicSources} onClick={() => setOpen(!open)}>{open ? '−' : '+'}</Button><div hidden={!open}><div className="library-actions"><SourceImportDialog notebookId={notebookId}/><AddExistingSourcesDialog notebookId={notebookId}/></div><SourceList notebookId={notebookId}/></div></section>;
}
