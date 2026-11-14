import { useState } from 'react';
import { Link } from 'react-router';
import type { SourceView, SourceVersionView } from '@study/contracts';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { SourceDetails } from './SourceDetails';
import type { SourceReadIntent } from './source-selection';
export function SourceRow({ source, selected, disabled, uploadDisabled, onSelect, onRead, onUpload }: {
    source: SourceView;
    selected: readonly string[];
    disabled: boolean;
    uploadDisabled: boolean;
    onSelect: (id: string, include: boolean) => void;
    onRead: (intent: SourceReadIntent) => void;
    onUpload: (id: string) => void;
}) { const [open, setOpen] = useState(false); const { t, notebook: m } = useI18n(); const id = typeof source.source_id === 'string' ? source.source_id : null; const versions = Array.isArray(source.versions) ? source.versions as SourceVersionView[] : []; if (id && !versions.length)
    return <li className="source-row"><Link className="record-link" to={`/sources/${encodeURIComponent(id)}`}>{typeof source.title === 'string' && source.title.trim() ? source.title : t.common.source}</Link><p>{m.noVersion}</p><Button disabled={uploadDisabled} onClick={() => onUpload(id)}>{t.workbench.uploadVersion}</Button></li>; return <li className="source-row"><Button onClick={() => { const latest = versions.filter(v => !v.projection_status && typeof v.source_version_id === 'string').sort((a,b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0]; if (!source.projection_status && latest && typeof latest.source_version_id === 'string') onRead({ source_version_id: latest.source_version_id }); }}>{typeof source.title === 'string' && source.title.trim() ? source.title : t.common.source}</Button><Button variant="quiet" aria-expanded={open} onClick={() => setOpen(!open)}>{t.workbench.askScope}</Button><span className="meta">{t.workbench.selectedVersions}: {versions.filter(version => typeof version.source_version_id === 'string' && selected.includes(version.source_version_id)).length}</span>{open && <div>{id && <Link className="record-link" to={`/sources/${encodeURIComponent(id)}`}>{t.workbench.read}</Link>}{versions.length ? <SourceDetails sourceTitle={typeof source.title === 'string' ? source.title : t.common.source} versions={versions} selected={selected} disabled={disabled || !!source.projection_status} onSelect={onSelect} onRead={onRead}/> : <p>{m.noVersion}</p>}{id && <Button disabled={uploadDisabled} onClick={() => onUpload(id)}>{t.workbench.uploadVersion}</Button>}</div>}</li>; }
