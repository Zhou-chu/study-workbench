import type { LibraryDraft } from './library-store';
import { GlobalSaveDialog } from './GlobalSaveDialog';
import { useState } from 'react';
import { AppChrome } from '../../app/AppChrome';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import type { GlobalQuery } from '../../data/global-search';
import { useGlobalSearch } from './use-global-search';
import { GlobalModelsDialog } from './GlobalModelsDialog';
import { GlobalSearchResults } from './GlobalSearchResults';
import { GlobalAskResponse } from './GlobalAskResponse';
export function GlobalSearchPage() {
    const s = useGlobalSearch(), { global: g, t } = useI18n(), [pending, setPending] = useState<{
        query: GlobalQuery;
        owner: LibraryDraft;
    } | null>(null), [saveId, setSaveId] = useState<string | null>(null);
    const p = s.input, busy = s.outputs.some(r => r.status === 'pending');
    const submit = () => { if (!p || !s.canSubmit(p))
        return; if (p.mode === 'ask')
        setPending({ query: { ...p, notebooks: [...p.notebooks] }, owner: s.row! });
    else
        void s.submit(p); };
    return <AppChrome title={t.navigation.askAndSearch}><div className="notebook-home library-page global-search"><header className="page-heading"><h1>{t.navigation.askAndSearch}</h1><p>{t.searchPage.searchDesc}</p></header>
 {p && <><form onSubmit={e => { e.preventDefault(); submit(); }}><label>{g.mode}<select value={p.mode} disabled={s.locked} onChange={e => s.edit({ mode: e.target.value === 'ask' ? 'ask' : 'search' })}><option value="search">{g.search}</option><option value="ask">{g.ask}</option></select></label>
 <label>{g.question}<textarea value={p.question} disabled={s.locked} onChange={e => s.edit({ question: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
        } }}/></label>
 <fieldset disabled={s.locked}><legend>{g.scope}</legend><p>{t.searchPage.scopeHint}</p>{s.notebooks.data?.map(n => <label className="library-check" key={n.id}><input type="checkbox" aria-label={g.scope + ' · ' + n.name} checked={p.notebooks.includes(n.id)} onChange={e => s.edit({ notebooks: e.target.checked ? [...p.notebooks, n.id] : p.notebooks.filter(id => id !== n.id) })}/>{n.name}</label>)}
 {p.notebooks.filter(id => !s.notebooks.data?.some(n => n.id === id)).map(id => <p key={id}>{id} · {t.common.unknown}</p>)}<Button onClick={() => s.edit({ notebooks: [] })}>{g.whole}</Button></fieldset>
 {p.mode === 'search' && <fieldset disabled={s.locked}><legend>{g.type}</legend><label>{g.type}<select value={p.searchType} onChange={e => s.edit({ searchType: e.target.value === 'vector' ? 'vector' : 'text' })}><option value="text">{g.text}</option><option value="vector">{g.vector}</option></select></label><label className="library-check"><input type="checkbox" checked={p.includeSources} onChange={e => s.edit({ includeSources: e.target.checked })}/>{g.sources}</label><label className="library-check"><input type="checkbox" checked={p.includeNotes} onChange={e => s.edit({ includeNotes: e.target.checked })}/>{g.notes}</label></fieldset>}
 {(p.mode === 'ask' || p.searchType === 'vector') && !s.defaults.isPending && !s.defaults.data?.default_embedding_model && <p role="alert">{t.searchPage.noEmbeddingModel}</p>}
 <Button variant="primary" type="submit" disabled={!s.canSubmit(p)}>{p.mode === 'ask' ? g.ask : g.search}</Button>
 </form>{(s.locked || s.submitted) && <Button disabled={!s.ready || busy} onClick={s.newQuestion}>{g.newIntent}</Button>}</>}
 {(s.notebooks.isError || s.models.isError || s.defaults.isError) && <p role="alert">{t.common.contentUnavailable.errorTitle}</p>}
 {pending && <GlobalModelsDialog models={s.models.data ?? []} initial={s.defaults.data?.default_chat_model ?? null} ready={s.canSubmit(pending.query, pending.owner)} onCancel={() => setPending(null)} onSubmit={chosen => { setPending(null); void s.submit(pending.query, chosen, pending.owner); }}/>}
 {s.outputs.map(row => <article className="library-operation" key={row.id}><h2>{row.input.kind === 'global-run' ? row.input.question : ''}</h2>
 {row.status === 'unknown' && <p role="alert">{g.unknown}</p>}{row.status === 'rejected' && <p role="alert">{g.rejected}</p>}{row.status === 'not-sent' && <p role="status">{g.notSent}</p>}
 {row.global?.search && <GlobalSearchResults value={row.global.search} owner={row}/>}
 {row.input.kind === 'global-run' && row.input.mode === 'ask' && <GlobalAskResponse row={row} onStop={() => s.stop(row.id)} onSave={() => setSaveId(row.id)}/>}
 </article>)}{saveId && s.store.get(saveId) && <GlobalSaveDialog answer={s.store.get(saveId)!} notebooks={s.notebooks.data ?? []} onClose={() => setSaveId(null)}/>}</div></AppChrome>;
}
