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
    return <li className="source-row"><Link className="record-link" to={`/sources/${encodeURIComponent(id)}`}>{typeof source.title === 'string' ? source.title : id}</Link><p>{m.noVersion}</p><Button disabled={uploadDisabled} onClick={() => onUpload(id)}>{t.workbench.uploadVersion}</Button></li>; return <li className="source-row"><Button aria-expanded={open} onClick={() => setOpen(!open)}>{typeof source.title === 'string' ? source.title : id ?? t.common.unknown}</Button><span className="meta">{versions.length}</span>{open && <div>{id && <Link className="record-link" to={`/sources/${encodeURIComponent(id)}`}>{id}</Link>}{versions.length ? <SourceDetails versions={versions} selected={selected} disabled={disabled || !!source.projection_status} onSelect={onSelect} onRead={onRead}/> : <p>{m.noVersion}</p>}{id && <Button disabled={uploadDisabled} onClick={() => onUpload(id)}>{t.workbench.uploadVersion}</Button>}</div>}</li>; }
