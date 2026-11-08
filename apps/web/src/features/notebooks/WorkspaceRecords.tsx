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
    const { t } = useI18n();
    return <>{workspace.legacy_history.length > 0 && <section className="workspace-history" aria-label={t.workbench.importedHistory}><h3>{t.workbench.importedHistory}</h3>{workspace.legacy_history.map((history, i) => <article key={i}>{'messages' in history && Array.isArray(history.messages) ? history.messages.map((message, j) => <p key={j}>{'content' in message && text(message.content) ? message.content : t.common.unknown}</p>) : <p>{t.common.unknown}</p>}</article>)}</section>}</>;
}
export function WorkspaceScope({ workspace }: {
    workspace: WorkspaceViewV1;
}) {
    const { t } = useI18n();
    const selection = workspace.selection;
    const engine = selection && 'engine' in selection ? selection.engine : undefined;
    const origin = selection && 'selection_origin' in selection ? selection.selection_origin : undefined;
    const versions = selection && 'source_version_ids' in selection ? selection.source_version_ids : undefined;
    const remote = selection && 'remote_source_ids' in selection ? selection.remote_source_ids : undefined;
    return <section className="workspace-scope" aria-label={t.workbench.askScope}><strong>{t.workbench.askScope}</strong><dl><dt>{t.workbench.engine}</dt><dd>{text(engine) ? engine : t.common.unknown}</dd><dt>{t.workbench.scope}</dt><dd>{text(origin) ? origin : t.common.unknown}</dd><dt>{t.workbench.selectedVersions}</dt><dd>{Array.isArray(versions) ? versions.join(', ') : t.common.unknown}</dd><dt>{t.workbench.selectedRemoteSources}</dt><dd>{Array.isArray(remote) ? remote.join(', ') : t.common.unknown}</dd></dl>{!['independent', 'notebooklm'].includes(text(engine) ? engine : '') && <p>{t.workbench.unknownEngine}</p>}{!['local', 'remote'].includes(text(origin) ? origin : '') && <p>{t.workbench.unknownScope}</p>}<p>{t.workbench.readingScopeHint}</p></section>;
}
