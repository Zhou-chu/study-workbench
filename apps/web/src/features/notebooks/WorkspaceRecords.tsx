import { LegacyHistory } from '../library/LegacyHistory';
import { Link } from 'react-router';
import type { WorkspaceViewV1 } from '@study/contracts';
import { useI18n } from '../../i18n';
const text = (value: unknown): value is string => typeof value === 'string';
/** Public read projection only. Feature-owned controls and canonical turn reconciliation remain downstream. */
export function WorkspaceSources({ workspace }: {
    workspace: WorkspaceViewV1;
}) {
    const { t, notebook: messages } = useI18n();
    return <><div className="panel-heading"><h2>{t.workbench.sources}</h2><span className="meta">{workspace.sources.length}</span></div><p className="panel-hint">{t.workbench.readingScopeHint}</p><ul className="workspace-records">{workspace.sources.map((source, index) => <li key={index}>{'source_id' in source && text(source.source_id) ? <><Link className="record-link" to={`/sources/${encodeURIComponent(source.source_id)}`}>{text(source.title) && source.title ? source.title : source.source_id}</Link><p className="meta">{source.source_id}</p>{Array.isArray(source.versions) && source.versions.some(version => 'source_version_id' in version && text(version.source_version_id)) ? <ul>{source.versions.map((version, i) => <li key={i}>{'source_version_id' in version && text(version.source_version_id) ? <><span>{version.source_version_id}</span>{text(version.origin) && <p className="meta">{version.origin}</p>}{text(version.created_at) && <time dateTime={version.created_at}>{version.created_at}</time>}</> : <p>{t.common.unknown}</p>}</li>)}</ul> : <p className="panel-hint">{messages.noVersion}</p>}</> : <p>{t.common.unknown}</p>}</li>)}</ul></>;
}
export function WorkspaceHistory({ workspace }: {
    workspace: WorkspaceViewV1;
}) {
    return <LegacyHistory history={workspace.legacy_history}/>;
}
export function WorkspaceScope({ workspace }: { workspace: WorkspaceViewV1 }) {
    const { t } = useI18n();
    const selection = workspace.selection;
    const engine = selection && 'engine' in selection ? selection.engine : undefined;
    const origin = selection && 'selection_origin' in selection ? selection.selection_origin : undefined;
    const versions = selection && 'source_version_ids' in selection && Array.isArray(selection.source_version_ids) ? selection.source_version_ids : [];
    const remote = selection && 'remote_source_ids' in selection && Array.isArray(selection.remote_source_ids) ? selection.remote_source_ids : [];
    return <section className="workspace-scope" aria-label={t.workbench.askScope}>
      <span className="scope-dot" aria-hidden="true" />
      <span>{engine === 'notebooklm' ? t.workbench.notebooklm : engine === 'independent' ? t.workbench.independent : t.workbench.unknownEngine}</span>
      {!['local', 'remote'].includes(typeof origin === 'string' ? origin : '') && <span>{t.workbench.unknownScope}</span>}
      <span className="scope-separator" aria-hidden="true">/</span>
      <span>{t.workbench.selectedCount.replace('{{count}}', String(versions.length + remote.length))}</span>
    </section>;
}
