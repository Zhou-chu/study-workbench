import type { WorkbenchSelection } from '@study/contracts';
import { Button } from '../../ui/Button';
import { useI18n } from '../../i18n';
export function ScopeSummary({ selection, unconfirmed, onAdjustScope }: {
    selection: WorkbenchSelection | null;
    unconfirmed: boolean;
    onAdjustScope?: (() => void) | undefined;
}) {
    const { t } = useI18n();
    return <section className="chat-scope" aria-label={t.workbench.askScope}><strong>{t.workbench.askScope}</strong>{onAdjustScope && <Button variant="quiet" onClick={onAdjustScope}>{t.workbench.changeScope}</Button>}<p>{selection?.engine === 'independent' ? t.workbench.independent : selection?.engine === 'notebooklm' ? t.workbench.notebooklm : t.workbench.unknownEngine} · {selection?.selection_origin === 'local' ? t.workbench.localScope : selection?.selection_origin === 'remote' ? t.workbench.remoteScope : t.workbench.unknownScope} · {selection ? (selection.selection_origin === 'local' ? selection.source_version_ids : selection.remote_source_ids).length : 0}</p>{unconfirmed && <p role="status">{t.workbench.selectionUnconfirmed}</p>}</section>;
}
