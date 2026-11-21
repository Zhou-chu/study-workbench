import { useState } from 'react';
import { Link } from 'react-router';
import type { SourceView, SourceVersionView } from '@study/contracts';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { SourceDetails } from './SourceDetails';
import { defaultReadableVersionId, type SourceReadIntent } from './source-selection';
export function SourceRow({ source, selected, disabled, uploadDisabled, onSelect, onRead, onUpload }: {
    source: SourceView;
    selected: readonly string[];
    disabled: boolean;
    uploadDisabled: boolean;
    onSelect: (id: string, include: boolean) => void;
    onRead: (intent: SourceReadIntent) => void;
    onUpload: (id: string) => void;
}) { const [open, setOpen] = useState(false); const { t, notebook: m, source: sourceText } = useI18n(); const id = typeof source.source_id === 'string' ? source.source_id : null; const versions = Array.isArray(source.versions) ? source.versions as SourceVersionView[] : []; if (id && !versions.length)
    return <li className="source-row"><Link className="record-link" to={`/sources/${encodeURIComponent(id)}`}>{typeof source.title === 'string' && source.title.trim() ? source.title : t.common.source}</Link><p>{m.noVersion}</p><Button disabled={uploadDisabled} onClick={() => onUpload(id)}>{t.workbench.uploadVersion}</Button></li>;
    const latest = source.projection_status ? null : defaultReadableVersionId(versions);
    const hasReadableVersion = versions.some(version => !version.projection_status && typeof version.source_version_id === 'string' && !!version.source_version_id.trim());
    return <li className="source-row"><Button aria-expanded={latest === null ? open : undefined} onClick={() => {
        if (latest === null) setOpen(true);
        else onRead({ source_version_id: latest });
    }}>{typeof source.title === 'string' && source.title.trim() ? source.title : t.common.source}</Button><Button variant="quiet" aria-expanded={open} onClick={() => setOpen(!open)}>{t.workbench.askScope}</Button><span className="meta">{t.workbench.selectedVersions}: {versions.filter(version => typeof version.source_version_id === 'string' && selected.includes(version.source_version_id)).length}</span>{open && <div>{latest === null && versions.length > 0 && <p className="meta">{hasReadableVersion ? sourceText.chooseReadableVersion : sourceText.unavailableOperation}</p>}{id && <Link className="record-link" to={`/sources/${encodeURIComponent(id)}`}>{t.workbench.read}</Link>}{versions.length ? <SourceDetails sourceTitle={typeof source.title === 'string' ? source.title : t.common.source} versions={versions} selected={selected} disabled={disabled || !!source.projection_status} onSelect={onSelect} onRead={onRead}/> : <p>{m.noVersion}</p>}{id && <Button disabled={uploadDisabled} onClick={() => onUpload(id)}>{t.workbench.uploadVersion}</Button>}</div>}</li>; }
