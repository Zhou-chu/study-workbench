import type { SourceVersionView } from '@study/contracts';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { safeSourceUrl } from '../../data/source-api';
import type { SourceReadIntent } from './source-selection';
export function SourceDetails({ versions, selected, disabled, onSelect, onRead }: {
    versions: readonly SourceVersionView[];
    selected: readonly string[];
    disabled: boolean;
    onSelect: (id: string, include: boolean) => void;
    onRead: (intent: SourceReadIntent) => void;
}) { const { source: m, t, shell } = useI18n(); return <ul className="source-versions">{versions.map((version, i) => { const id = typeof version.source_version_id === 'string' ? version.source_version_id : null; const provenance = version.provenance && 'kind' in version.provenance ? version.provenance : null; const url = safeSourceUrl(provenance?.source_url); return <li key={id ?? i}>{id ? <><p className="source-id">{id}</p>{typeof version.created_at === 'string' && <time dateTime={version.created_at}>{version.created_at}</time>}<p className="meta">{[version.origin, version.status, version.extraction_status, version.original_status].filter(v => typeof v === 'string').join(' · ')}</p>{typeof version.sha256 === 'string' && <p className="source-id">{version.sha256}</p>}{provenance && <div className="source-provenance"><span>{typeof provenance.kind === 'string' ? provenance.kind : t.common.unknown}</span>{typeof provenance.origin_title === 'string' && <p>{provenance.origin_title}</p>}{typeof provenance.provider === 'string' && <p>{provenance.provider}</p>}{typeof provenance.retrieved_at === 'string' && <time>{provenance.retrieved_at}</time>}{url && <a className="record-link" href={url} target="_blank" rel="noopener noreferrer">{url}</a>}{typeof provenance.search_result_snippet === 'string' && <p>{provenance.search_result_snippet}</p>}</div>}<div className="source-actions"><label className="source-check"><input type="checkbox" aria-label={`${m.select} ${id}`} checked={selected.includes(id)} disabled={disabled || !!version.projection_status} onChange={e => onSelect(id, e.target.checked)}/>{m.select}</label><Button disabled={!!version.projection_status} aria-label={`${shell.read} ${id}`} onClick={() => onRead({ source_version_id: id })}>{shell.read}</Button></div></> : t.common.unknown}</li>; })}</ul>; }
