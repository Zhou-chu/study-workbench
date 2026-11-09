import type { LibraryDraft } from './library-store';
import { useI18n } from '../../i18n';
import { Markdown } from '../../ui/Markdown';
import { Button } from '../../ui/Button';
import { RecordReferences } from './RecordReference';
export function GlobalAskResponse({ row, onStop, onSave }: {
    row: LibraryDraft;
    onStop(): void;
    onSave(): void;
}) {
    const { global: g, native: n, t } = useI18n(), v = row.global;
    return <section className="global-answer" aria-live="polite">
 {v?.strategy && <details><summary>{g.strategy}</summary><Markdown>{v.strategy.reasoning}</Markdown>{v.strategy.searches.map((s, i) => <article key={i}><h4>{s.term}</h4><p>{s.instructions}</p></article>)}</details>}
 {!!v?.answers?.length && <details><summary>{g.intermediate}</summary>{v.answers.map((answer, i) => <article key={i}><Markdown>{answer}</Markdown><RecordReferences content={answer} owner={row}/></article>)}</details>}
 {v?.final && <article><h3>{g.final}</h3><Markdown>{v.final}</Markdown><RecordReferences content={v.final} owner={row}/></article>}
 {row.status === 'pending' && <><p role="status">{t.common.loading}</p><Button onClick={onStop}>{n.stop}</Button></>}
 {v?.terminal === 'no-answer' && <p role="status">{g.noAnswer}</p>}
 {v?.terminal === 'error' && <><p role="alert">{g.failed}</p><p>{v.message}</p></>}
 {v?.terminal === 'answer' && row.status === 'succeeded' && <Button onClick={onSave}>{g.save}</Button>}
 </section>;
}
