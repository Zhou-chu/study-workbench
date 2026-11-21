import { isRecord } from '@study/contracts';
import { useI18n } from '../../i18n';
import { Markdown } from '../../ui/Markdown';
import { RecordReferences } from './RecordReference';
/** Public imported history is read-only, never a native session or replay handle. */
export function LegacyHistory({ history }: {
    history: readonly unknown[];
}) {
    const { native: n, t } = useI18n(), known = (v: unknown) => typeof v === 'string' ? v : t.common.unknown;
    if (!history.length)
        return null;
    return <section className="workspace-history" aria-label={n.history}><h3>{t.workbench.importedHistory}</h3>{history.map((item, i) => <article key={i}>{isRecord(item) ? <><p className="meta">{known(item.chat_session_id)} · {known(item.history_origin)} · {known(item.created_at)}</p>{Array.isArray(item.messages) ? item.messages.map((v, j) => <article key={j}>{isRecord(v) ? <><p className="meta">{known(v.role)} · {known(v.type)} · {known(v.id)} · {known(v.timestamp)}</p><Markdown>{known(v.content)}</Markdown>{typeof v.content === 'string' && <RecordReferences content={v.content}/>}</> : <p>{t.common.unknown}</p>}</article>) : <p>{t.common.unknown}</p>}</> : <p>{t.common.unknown}</p>}</article>)}</section>;
}
