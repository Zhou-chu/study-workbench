import { useState } from 'react';
import { isRecord } from '@study/contracts';
import { resultScore, type SearchResponse } from '../../data/global-search';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import type { LibraryDraft } from './library-store';
import { useRecordReferenceAdmission, RecordReference, recordReferences, type RecordIdentity } from './RecordReference';
export function GlobalSearchResults({ value, owner }: {
    value: SearchResponse;
    owner: LibraryDraft;
}) {
    const { global: g, t, native: n } = useI18n(), [selected, setSelected] = useState<RecordIdentity | null>(null);
    const admitted = useRecordReferenceAdmission(owner);
    const results = value.results.map((row, index) => ({ row, index })).sort((a, b) => (resultScore(b.row) ?? 0) - (resultScore(a.row) ?? 0) || a.index - b.index);
    return <section>{!admitted() && <p role="status">{g.retainedReadOnly}</p>}<p role="status">{t.searchPage.resultsFound.replace('{{count}}', String(value.total_count))}</p><ul className="global-results">{results.map(({ row, index }) => {
            const identity = typeof row.id === 'string' ? recordReferences(row.id).find(ref => ref.id === row.id) : undefined, score = resultScore(row);
            const matches = Array.isArray(row.matches) ? row.matches : [];
            return <li key={index}><h3>{typeof row.title === 'string' ? row.title : t.common.unknown}</h3>{typeof row.id === 'string' && <p className="meta">{row.id}</p>}
  {score !== null && <p>{g.score + ': ' + score}</p>}{identity && <Button disabled={!admitted()} onClick={() => { if (admitted()) setSelected(identity); }}>{n.reference + ' · ' + identity.id}</Button>}
  {matches.length > 0 && <details><summary>{g.matches}</summary>{matches.map((match, i) => <p key={i}>{typeof match === 'string' ? match : isRecord(match) && typeof match.content === 'string' ? match.content : JSON.stringify(match)}</p>)}</details>}
  </li>;
        })}</ul>{selected && <RecordReference key={selected.id} reference={selected} owner={owner} onClose={() => setSelected(null)}/>}</section>;
}
