import type { WorkbenchSelection } from '@study/contracts';
import { useI18n } from '../../i18n';
export function ScopeSummary({ selection, unconfirmed }: {
    selection: WorkbenchSelection | null;
    unconfirmed: boolean;
}) {
    const { t } = useI18n();
    return <section className="chat-scope" aria-label={t.workbench.askScope}><strong>{t.workbench.askScope}</strong><p>{selection?.engine === 'independent' ? t.workbench.independent : selection?.engine === 'notebooklm' ? t.workbench.notebooklm : t.workbench.unknownEngine} · {selection?.selection_origin === 'local' ? t.workbench.localScope : selection?.selection_origin === 'remote' ? t.workbench.remoteScope : t.workbench.unknownScope} · {selection ? (selection.selection_origin === 'local' ? selection.source_version_ids : selection.remote_source_ids).length : 0}</p>{unconfirmed && <p role="status">{t.workbench.selectionUnconfirmed}</p>}<details><summary>{t.workbench.selectedVersions}</summary><ul>{[...(selection?.source_version_ids ?? []), ...(selection?.remote_source_ids ?? [])].map(id => <li key={id}>{id}</li>)}</ul></details></section>;
}
