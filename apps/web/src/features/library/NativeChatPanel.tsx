import type { LibrarySource } from '../../data/library-api';
import { FreshLibraryIntent } from './FreshLibraryIntent';
import { useState } from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { Markdown } from '../../ui/Markdown';
import { type NativeParent, type ContextConfig } from '../../data/native-chat';
import { useNativeChat } from './use-native-chat';
import { LibraryDialog } from './LibraryDialog';
import { RecordReferences } from './RecordReference';
import { ClassicMessageSave } from './ClassicMessageSave';
export function NativeChatPanel({ parent, config, sourceNoteOrigin }: {
    parent: NativeParent;
    config?: ContextConfig;
    sourceNoteOrigin?: {
        notebookId: string;
        source: LibrarySource;
    };
}) {
    const chat = useNativeChat(parent, config), { native: n, t } = useI18n(), [confirm, setConfirm] = useState(false), [copyState, setCopyState] = useState<'idle' | 'saved' | 'error'>('idle');
    const isSource = parent.kind === 'source', busy = chat.mutations.some(r => r.status === 'pending' || r.status === 'unknown'), pending = chat.row?.status === 'pending';
    const actual = chat.inspection ?? chat.session, selection = chat.selected ?? actual?.id ?? '', model = actual ? actual.model_override ?? '' : chat.input?.model ?? '';
    const sessionOptions = [...new Map([...(chat.list.data ?? []), ...(actual ? [actual] : [])].filter(s => !chat.store.nativeDeleted(parent, s.id)).map(s => [s.id, s])).values()];
    return <section className="native-chat" aria-label={isSource ? n.sourceChat : n.classic}>
 <div className="library-toolbar"><label>{n.session}<select value={selection} disabled={!chat.ready} onChange={e => chat.choose(e.target.value || null)}><option value="">{n.create}</option>{sessionOptions.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label><Button disabled={!chat.ready || chat.list.isFetching} onClick={() => void chat.list.refetch()}>{t.common.refresh}</Button></div>
 {(chat.error || chat.list.isError || chat.models.isError || chat.defaults.isError) && <p role="alert">{t.common.contentUnavailable.errorTitle}</p>}
 {chat.inspection && <p role="alert">{n.parentUnavailable}</p>}
 <label>{n.title}<input value={chat.input?.title ?? ''} disabled={chat.locked} onChange={e => chat.edit({ title: e.target.value })}/></label>
 <div className="library-actions"><Button disabled={!chat.ready || busy} onClick={() => void chat.mutate('create', chat.input?.title ?? '')}>{n.create}</Button><Button disabled={!chat.owned || busy || !chat.input?.title.trim()} onClick={() => void chat.mutate('rename', chat.input!.title)}>{n.rename}</Button><Button disabled={!chat.owned || busy} onClick={() => setConfirm(true)}>{n.remove}</Button></div>
 <label>{n.model}<select value={model} disabled={chat.locked || busy || chat.models.isPending || chat.models.isError} onChange={e => actual ? void chat.mutate('model', e.target.value || null) : chat.edit({ model: e.target.value || null })}><option value="" disabled={isSource && !!actual?.model_override}>{n.defaultModel}</option>{model && !chat.models.data?.some(m => m.type === 'language' && m.id === model) && <option value={model} disabled>{model + ' · ' + t.common.unknown}</option>}{chat.models.data?.filter(m => m.type === 'language').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
 {chat.defaults.data && <p className="meta">{n.defaultModel}: {chat.models.data?.find(m => m.id === chat.defaults.data?.default_chat_model)?.name ?? chat.defaults.data.default_chat_model ?? t.common.unknown}</p>}
 {isSource && !!actual?.model_override && <p>{n.sourceReset}</p>}
 {chat.row?.status === 'not-sent' && <p role="status">{n.notSent}</p>}{chat.row?.status === 'rejected' && <p role="alert">{n.rejected}</p>}
 {chat.row?.status === 'unknown' && <p role="alert">{n.unknown}</p>}
 {chat.mutations.filter(r => r.status === 'unknown').map(r => <p role="alert" key={r.id}>{n.unknown} {r.native?.session?.id ?? (r.input.kind === 'native-session' ? r.input.sessionId : '')}</p>)}
 {chat.row?.status === 'unknown' && actual && <Button onClick={() => void chat.check()}>{n.check}</Button>}
 {pending && <Button onClick={chat.stop}>{n.stop}</Button>}
 <div aria-live="polite" className="native-transcript">{chat.messages.map(message => <article key={message.id}><p className="meta">{message.type || t.common.unknown} · {message.timestamp ?? t.common.unknown}</p><Markdown>{message.content}</Markdown><RecordReferences content={message.content}/><div className="library-actions"><Button onClick={() => { void navigator.clipboard.writeText(message.content).then(() => setCopyState('saved'), () => setCopyState('error')); }}>{n.copy}</Button>{parent.kind === 'notebook' && chat.owned && actual && message.type === 'ai' && !message.provisional && <ClassicMessageSave notebookId={parent.notebookId} session={actual} message={message}/>}{parent.kind === 'source' && sourceNoteOrigin && chat.owned && actual && message.type === 'ai' && !message.provisional && <ClassicMessageSave notebookId={sourceNoteOrigin.notebookId} source={sourceNoteOrigin.source} session={actual} message={message}/>}</div></article>)}</div>
 {chat.row?.native?.checked && <details><summary>{n.check}</summary>{chat.row.native.checked.map(m => <article key={m.id}><Markdown>{m.content}</Markdown></article>)}</details>}
 {copyState === 'saved' && <p role="status">{t.common.success}</p>}{copyState === 'error' && <p role="alert">{t.common.contentUnavailable.errorTitle}</p>}
 {chat.row?.native?.indicators && <dl>{Object.entries(chat.row.native.indicators).map(([k, v]) => <div key={k}><dt>{k === 'sources' ? t.sources.title : k === 'notes' ? t.common.notes : t.sources.insights}</dt><dd>{v.join(', ') || '0'}</dd></div>)}</dl>}
 <FreshLibraryIntent row={chat.row} input={{ kind: 'native-chat', parent, sessionId: chat.input?.sessionId ?? null, message: '', model: null, title: '' }} onFresh={chat.onFresh}/>
 <form onSubmit={e => { e.preventDefault(); void chat.send(); }}><label>{isSource ? n.sourceMessage : n.message}<textarea value={chat.row?.status === 'succeeded' ? '' : chat.input?.message ?? ''} disabled={chat.locked} onChange={e => chat.edit({ message: e.target.value })}/></label><Button type="submit" disabled={chat.locked || chat.row?.status === 'succeeded' || !chat.input?.message.trim()}>{isSource ? n.sourceSend : n.send}</Button></form>
 <LibraryDialog open={confirm} onOpenChange={setConfirm} title={n.remove}><p>{actual?.title} {actual?.id}</p><Button onClick={() => setConfirm(false)}>{t.common.cancel}</Button><Button disabled={!chat.owned || busy} onClick={() => { setConfirm(false); void chat.mutate('delete'); }}>{t.common.confirm}</Button></LibraryDialog>
 </section>;
}
