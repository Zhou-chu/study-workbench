import { useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { AppChrome } from '../../app/AppChrome';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { Markdown } from '../../ui/Markdown';
import { LibraryDialog } from '../library/LibraryDialog';
import { editorDirty, editorPatch, type TransformationToken } from './transformation-store';
import { useTransformations } from './use-transformations';
export function TransformationsPage() {
    const c = useTransformations(), { row: r } = c, { t, transformation: m, configuration: cm } = useI18n();
    const [confirm, setConfirm] = useState<TransformationToken | null>(null), [replace, setReplace] = useState<string | null>(null), [discard, setDiscard] = useState(false);
    const opener = useRef<HTMLElement | null>(null);
    const focus = () => queueMicrotask(() => { if (opener.current?.isConnected && opener.current !== document.body && !(opener.current as HTMLButtonElement).disabled)
        opener.current.focus();
    else
        document.getElementById('main-content')?.focus(); });
    const close = () => { setConfirm(null); setReplace(null); setDiscard(false); focus(); };
    const queue = (token: TransformationToken | null) => { if (token) {
        opener.current = document.activeElement as HTMLElement;
        setConfirm(token);
    } };
    const choose = (id: string) => { if (r) {
        c.store.playground(r.id, { transformationId: id });
        c.store.view(r.id, { tab: 'playground' });
    } };
    const tryTransformation = (id: string) => { if (!r)
        return; if (r.playground.transformationId !== id && (r.playground.input || r.playground.transformationId)) {
        opener.current = document.activeElement as HTMLElement;
        setReplace(id);
    }
    else
        choose(id); };
    const editor = r?.editor, fields = editor?.fields, listReady = r?.listRead?.phase === 'ready', p = r?.playground;
    const editorValid = !!fields && fields.name.trim() && fields.title.trim() && fields.prompt.trim() && (fields.model_id === null || c.modelsReady && c.models.some(v => v.id === fields.model_id && v.type === 'language'));
    const executeReady = !!p && listReady && c.modelsReady && r.list.some(v => v.id === p.transformationId) && c.models.some(v => v.id === p.modelId && v.type === 'language') && !!p.input.trim();
    const modelOptions = (value: string, empty: string) => <><option value="">{empty}</option>{value && !c.models.some(v => v.id === value) && <option value={value} disabled>{t.common.unknown}: {value}</option>}{c.models.map(v => <option key={v.id} value={v.id} disabled={v.type !== 'language'}>{v.name} · {v.provider}{v.type === 'language' ? '' : ' · ' + t.common.unknown + ': ' + v.type}</option>)}</>;
    const status = (phase: string) => phase === 'pending' ? t.common.loading : phase === 'unknown' ? cm.unknown : phase === 'not-sent' ? t.noteConflict.notSent : t.common.success;
    return <AppChrome><section className="notebook-home transformations-page"><header><h1>{t.transformations.title}</h1><p>{t.transformations.desc}</p></header>
 {!r && <p role="status">{t.common.loading}</p>}
 {r && <>
 <div className="settings-actions"><Button disabled={!c.ready} onClick={() => void c.refresh()}>{m.refresh}</Button><Button disabled={!c.ready} onClick={() => void c.refreshModels()}>{m.refreshModels}</Button></div>
 <label>{m.records}<select value={r.id} onChange={e => { close(); c.store.select(e.target.value); }}>{c.rows.map((v, i) => <option key={v.id} value={v.id}>{i + 1}: {v.retired ? t.common.unknown : t.transformations.title}</option>)}</select></label>
 {r.retired && <p className="settings-danger" role="status">{cm.retired}<Button disabled={!c.context?.ready} onClick={() => { close(); c.fresh(); }}>{cm.fresh}</Button></p>}
 {r.listRead?.phase !== 'ready' && <p role={r.listRead?.phase === 'error' ? 'alert' : 'status'}>{r.listRead?.phase === 'error' ? t.common.error : t.common.loading}</p>}
 {c.modelState?.phase !== 'ready' && <p role={c.modelState?.phase === 'error' ? 'alert' : 'status'}>{m.modelsUnavailable}</p>}
 <Tabs.Root value={r.tab} onValueChange={tab => { if (tab === 'list' || tab === 'playground')
            c.store.view(r.id, { tab }); }}>
 <Tabs.List className="tabs-list" aria-label={t.transformations.title}><Tabs.Trigger className="tab" value="list">{t.transformations.title}</Tabs.Trigger><Tabs.Trigger className="tab" value="playground">{t.transformations.playground}</Tabs.Trigger></Tabs.List>
 <Tabs.Content value="list" className="tab-panel">
 <section><Button aria-expanded={r.instructionsOpen} aria-controls="transformation-instructions" onClick={() => c.store.view(r.id, { instructionsOpen: !r.instructionsOpen })}>{m.instructions}</Button>
 {r.instructionsOpen && <div id="transformation-instructions"><p>{m.globalEffect}</p>
 <label>{m.instructions}<textarea value={r.instructions.value} disabled={!c.ready} onChange={e => c.store.instructions(r.id, e.target.value)}/></label>
 {r.instructions.read?.phase !== 'ready' && <p role="status">{r.instructions.read?.phase === 'error' ? t.common.error : t.common.loading}</p>}
 <Button disabled={!c.ready || r.instructions.read?.phase !== 'ready' || r.instructions.value === r.instructions.baseline || c.store.locked(r.id, 'instructions')} onClick={() => queue(c.capture({ kind: 'instructions', value: r.instructions.value }))}>{m.saveInstructions}</Button></div>}</section>
 <div className="settings-actions"><Button disabled={!c.ready || editorDirty(editor ?? null) || c.store.locked(r.id, 'create')} onClick={event => { opener.current = event.currentTarget; void c.edit(null); }}>{m.create}</Button>
 {editor && <><Button onClick={event => { opener.current = event.currentTarget; c.store.showEditor(r.id, true); }}>{m.resume}</Button><Button disabled={!c.ready || c.store.locked(r.id, editor.target ?? 'create')} onClick={() => setDiscard(true)}>{m.discard}</Button></>}</div>
 {listReady && !r.list.length && <p>{t.transformations.noTransformations}</p>}
 <div className="transformation-list">{r.list.map(v => <article className="transformation-card" key={v.id}><h2>{v.title}</h2><p>{v.description}</p><p>{v.apply_default ? m.futureImports : t.common.no}</p>
 <div className="settings-actions"><Button aria-label={m.details + ' ' + v.title} aria-expanded={r.expanded.includes(v.id)} onClick={() => c.store.view(r.id, { expanded: r.expanded.includes(v.id) ? r.expanded.filter(id => id !== v.id) : [...r.expanded, v.id] })}>{m.details}</Button>
 <Button aria-label={t.common.edit + ' ' + v.title} disabled={!c.ready || !listReady || editorDirty(editor ?? null) || c.store.locked(r.id, v.id)} onClick={event => { opener.current = event.currentTarget; void c.edit(v.id); }}>{t.common.edit}</Button>
 <Button variant="danger" aria-label={t.common.delete + ' ' + v.title} disabled={!c.ready || !listReady || c.store.locked(r.id, v.id)} onClick={() => queue(c.capture({ kind: 'delete', target: v.id, title: v.title }))}>{t.common.delete}</Button>
 <Button aria-label={m.try + ' ' + v.title} disabled={!c.ready || !listReady} onClick={() => tryTransformation(v.id)}>{m.try}</Button></div>
 {r.expanded.includes(v.id) && <section aria-label={v.title}><p>{v.name}</p><p className="source-id">{v.id}</p><p>{v.model_id ?? t.transformations.systemDefault}</p><Markdown>{v.prompt}</Markdown></section>}
 </article>)}</div></Tabs.Content>
 <Tabs.Content value="playground" className="tab-panel"><p>{m.executionWarning}</p>
 <label>{m.transformation}<select value={p!.transformationId} disabled={!c.ready || !listReady} onChange={e => c.store.playground(r.id, { transformationId: e.target.value })}><option value="">{t.transformations.selectToStart}</option>{p!.transformationId && !r.list.some(v => v.id === p!.transformationId) && <option value={p!.transformationId} disabled>{t.common.unknown}: {p!.transformationId}</option>}{r.list.map(v => <option key={v.id} value={v.id}>{v.title}</option>)}</select></label>
 <label>{m.languageModel}<select value={p!.modelId} disabled={!c.ready || !c.modelsReady} onChange={e => c.store.playground(r.id, { modelId: e.target.value })}>{modelOptions(p!.modelId, t.transformations.selectModel)}</select></label>
 <label>{m.input}<textarea value={p!.input} disabled={!c.ready} onChange={e => c.store.playground(r.id, { input: e.target.value })}/></label>
 <Button disabled={!c.ready || !executeReady || c.store.locked(r.id, 'execute')} onClick={() => queue(c.capture({ kind: 'execute', input: { transformation_id: p!.transformationId, model_id: p!.modelId, input_text: p!.input }, title: r.list.find(v => v.id === p!.transformationId)!.title }))}>{m.run}</Button>
 </Tabs.Content></Tabs.Root>
 <section aria-label={m.requests} aria-live="polite">{r.attempts.map(a => <article key={a.token.id} className={a.phase === 'unknown' ? 'settings-danger' : 'transformation-attempt'}><p role={a.phase === 'unknown' ? 'alert' : 'status'}>{status(a.phase)}</p><p>{m.original}: {a.token.intent.kind === 'execute' || a.token.intent.kind === 'delete' ? a.token.intent.title : a.token.intent.kind === 'instructions' ? m.instructions : t.transformations.title}</p>
 {a.httpStatus !== undefined && <p>{t.common.error}: {a.httpStatus}</p>}
 {a.token.intent.kind === 'execute' && <><p className="source-id">{a.token.intent.input.transformation_id} · {a.token.intent.input.model_id}</p><details><summary>{m.input}</summary><pre>{a.token.intent.input.input_text}</pre></details></>}
 {a.output && <><h2>{t.transformations.outputLabel}</h2><p>{m.requestedIdentity}: {a.output.model_id ?? t.common.unknown}</p><p>{m.identityLimit}</p><Markdown>{a.output.output}</Markdown></>}
 </article>)}</section>
 {editor?.open && fields && !confirm && <LibraryDialog open onOpenChange={open => { if (!open) {
                c.store.showEditor(r.id, false);
                focus();
            } }} title={editor.target ? t.common.edit : m.create}>
 {editor.read?.phase === 'loading' ? <p>{t.common.loading}</p> : editor.read?.phase === 'error' ? <p role="alert">{t.common.error}</p> : <fieldset disabled={!c.ready} className="transformation-editor">
 <label>{t.common.name}<input value={fields.name} onChange={e => c.store.edit(r.id, { name: e.target.value })}/></label>
 <label>{m.title}<input value={fields.title} onChange={e => c.store.edit(r.id, { title: e.target.value })}/></label>
 <label>{t.common.description}<textarea value={fields.description} onChange={e => c.store.edit(r.id, { description: e.target.value })}/></label>
 <label>{m.prompt}<textarea value={fields.prompt} onChange={e => c.store.edit(r.id, { prompt: e.target.value })}/></label>
 <label>{m.defaultModel}<select value={fields.model_id ?? ''} disabled={!c.modelsReady} onChange={e => c.store.edit(r.id, { model_id: e.target.value || null })}>{modelOptions(fields.model_id ?? '', t.transformations.systemDefault)}</select></label>
 <label className="transformation-check"><input type="checkbox" checked={fields.apply_default} onChange={e => c.store.edit(r.id, { apply_default: e.target.checked })}/>{m.futureImports}</label><p>{m.importEffect}</p>
 <Button disabled={!editorValid || !editorDirty(editor) || c.store.locked(r.id, editor.target ?? 'create')} onClick={() => queue(c.capture(editor.target ? { kind: 'update', target: editor.target, editorId: editor.id, input: editorPatch(editor) } : { kind: 'create', editorId: editor.id, input: fields }))}>{m.save}</Button></fieldset>}
 <Button onClick={() => { c.store.showEditor(r.id, false); focus(); }}>{t.common.cancel}</Button></LibraryDialog>}
 {confirm && <LibraryDialog open onOpenChange={open => { if (!open)
                close(); }} title={cm.confirm} description={confirm.intent.kind === 'execute' ? m.executionWarning : confirm.intent.kind === 'instructions' ? m.globalEffect : confirm.intent.kind === 'delete' ? m.deleteEffect : m.importEffect}>
 {confirm.intent.kind === 'execute' && <><p>{confirm.intent.title}</p><p>{confirm.models?.model.name} · {confirm.models?.model.provider}</p><p className="source-id">{confirm.intent.input.transformation_id} · {confirm.intent.input.model_id}</p></>}
 {confirm.intent.kind === 'delete' && <p>{confirm.intent.title} · {confirm.intent.target}</p>}
 <Button variant={confirm.intent.kind === 'delete' ? 'danger' : 'primary'} disabled={!c.valid(confirm)} onClick={() => { const original = confirm; if (!c.valid(original))
                return; void c.run(original); close(); }}>{cm.confirm}</Button><Button onClick={close}>{t.common.cancel}</Button></LibraryDialog>}
 {(replace !== null || discard) && <LibraryDialog open onOpenChange={open => { if (!open)
                close(); }} title={discard ? m.discard : m.replace} description={discard ? m.discardWarning : m.replaceWarning}>
 <Button variant="danger" onClick={() => { if (discard)
                c.store.discardEditor(r.id);
            else if (replace !== null)
                choose(replace); close(); }}>{cm.confirm}</Button><Button onClick={close}>{t.common.cancel}</Button></LibraryDialog>}
 </>}
 </section></AppChrome>;
}
