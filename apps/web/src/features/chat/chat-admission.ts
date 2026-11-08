import type { WorkspaceViewV1 } from '@study/contracts';
import type { TurnCapture } from '@study/domain';
export function readySources(workspace: WorkspaceViewV1, ids: readonly string[]) { return ids.length > 0 && ids.length <= 20 && ids.every(id => { const rows = workspace.sources.flatMap(s => 'versions' in s && !s.projection_status && Array.isArray(s.versions) ? s.versions : []).filter(v => 'source_version_id' in v && v.source_version_id === id); return rows.length === 1 && !rows[0]!.projection_status && 'extraction_status' in rows[0]! && rows[0]!.extraction_status === 'ready'; }); }
/** A newer ready selection or a same-label provider does not admit the original retry. */
export function originalScopeAvailable(capture: Pick<TurnCapture, 'dto' | 'googleConnectionId'>, workspace: WorkspaceViewV1): boolean {
    const { dto } = capture;
    if (workspace.notebook.id !== dto.notebook_id)
        return false;
    if (dto.selection_origin === 'local' && !readySources(workspace, dto.source_version_ids))
        return false;
    if (dto.engine === 'independent')
        return dto.selection_origin === 'local';
    const link = workspace.link;
    return !!link && !link.projection_status && 'remote_notebook_id' in link && link.remote_notebook_id === dto.remote_notebook_id && 'connection_id' in link && link.connection_id === capture.googleConnectionId && !!capture.googleConnectionId;
}
