import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { LibraryDialog } from '../library/LibraryDialog';
import { privateFields, type CredentialWrite, type PrivateField } from '../../data/configuration-contracts';
import type { ConfigurationController } from './use-configuration';
export function CredentialEditor({ config, refresh, enabled }: {
    config: ConfigurationController;
    refresh: () => Promise<unknown>;
    enabled: boolean;
}) {
    const { t, configuration: m } = useI18n(), form = config.row?.form;
    const inputs = useRef<Partial<Record<PrivateField | 'api_key', HTMLInputElement | null>>>({});
    const inputRefs = useRef<Partial<Record<PrivateField | 'api_key', (element: HTMLInputElement | null) => void>>>({});
    const bindInput = (key: PrivateField | 'api_key') => {
        const existing = inputRefs.current[key];
        if (existing) return existing;
        // A stable callback distinguishes a real detach from an ordinary rerender.
        const bind = (element: HTMLInputElement | null) => {
            if (!element && inputs.current[key]) inputs.current[key]!.value = '';
            inputs.current[key] = element;
        };
        inputRefs.current[key] = bind;
        return bind;
    };
    const pendingBody = useRef<CredentialWrite | null>(null);
    const [reveal, setReveal] = useState(false);
    const alive = useRef(true), version = useRef(0);
    const clear = () => {
        for (const input of Object.values(inputs.current))
            if (input)
                input.value = '';
        const body = pendingBody.current;
        if (body)
            for (const key of Object.keys(body) as (keyof CredentialWrite)[])
                delete body[key];
        version.current++;
        setReveal(false);
    };
    const epoch = config.row?.context.epoch;
    const identity = form?.identity;
    useEffect(() => {
        alive.current = true;
        const unregister = config.drafts.registerPrivateClear(epoch ?? -1, clear);
        return () => { alive.current = false; unregister(); clear(); };
    }, [config.drafts, epoch, identity]);
    if (!form || !config.row)
        return null;
    const row = config.row;
    const stale = !enabled || row.sources.credentials?.phase !== 'ready' || row.sources.credentials.revision !== form.credentialRevision;
    const typeLabel = (type: string) => ({ language: t.common.language, embedding: t.models.embedding, text_to_speech: t.models.tts, speech_to_text: t.models.stt }[type] ?? t.common.unknown + ': ' + type);
    const fieldLabel = (key: PrivateField) => key === 'base_url' ? t.apiKeys.baseUrl : key === 'credentials_path' ? t.apiKeys.vertexCredentials : m.endpoint + (key === 'endpoint' ? '' : ' · ' + typeLabel({ endpoint_llm: 'language', endpoint_embedding: 'embedding', endpoint_stt: 'speech_to_text', endpoint_tts: 'text_to_speech' }[key]));
    const visibleFields = privateFields.filter(key => key === 'base_url' || key === 'credentials_path' && form.provider.name === 'vertex' || key.startsWith('endpoint') && ['azure', 'openai_compatible'].includes(form.provider.name));
    if (row.retired) {
        return <section aria-label={m.retired}>
            <h3>{t.apiKeys.editConfig}</h3>
            <p>{form.name} · {form.provider.display_name}</p>
            <p>{form.modalities.map(typeLabel).join(' · ')}</p>
            <dl>{(['project', 'location', 'api_version', 'num_ctx'] as const).map(key => <div key={key}>
                <dt>{key === 'project' ? t.apiKeys.vertexProject : key === 'location' ? t.apiKeys.vertexLocation : key === 'api_version' ? m.apiVersion : t.apiKeys.numCtx}</dt>
                <dd>{form[key] || t.models.noneOption}</dd>
            </div>)}</dl>
        </section>;
    }
    const update = (patch: Partial<typeof form>) => config.store.setForm(row.id, { ...form, ...patch });
    const close = () => { clear(); config.store.setForm(row.id, null); };
    const submit = async () => {
        const before = version.current, body: CredentialWrite = {}, old = form.credential;
        try {
            if (config.locked || stale || !form.name.trim() || config.store.get(row.id)?.sources.credentials?.phase !== 'ready' || config.store.get(row.id)?.sources.credentials?.revision !== form.credentialRevision)
                return;
            if (!old || form.name !== old.name)
                body.name = form.name.trim();
            if (!old) {
                body.provider = form.provider.name;
                body.modalities = form.modalities;
            }
            else if (JSON.stringify(form.modalities) !== JSON.stringify(old.modalities))
                body.modalities = form.modalities;
            for (const key of ['project', 'location', 'api_version'] as const) {
                const value = form[key].trim();
                if (!old) {
                    if (value)
                        body[key] = value;
                }
                else if (value !== (old[key] ?? ''))
                    body[key] = value || null;
            }
            if (form.provider.name === 'vertex' && (!form.project.trim() || !form.location.trim()))
                return;
            if (form.provider.name === 'ollama' && form.num_ctx !== (old?.num_ctx === null || old?.num_ctx === undefined ? '' : String(old.num_ctx))) {
                const n = form.num_ctx.trim() ? Number(form.num_ctx) : 0;
                if (!Number.isSafeInteger(n) || n < 0)
                    return;
                body.num_ctx = n;
            }
            // Only safe field names/presence are read before the synchronous reservation.
            const presence: Record<string, 'set' | 'clear'> = {};
            for (const key of privateFields) {
                const mode = form.modes[key];
                if (mode === 'set' || mode === 'clear') presence[key] = mode;
            }
            if (inputs.current.api_key?.value.trim().length) presence.api_key = 'set';
            const fields = [...Object.keys(body), ...Object.keys(presence)];
            if (!fields.length) { close(); return; }
            const token = config.capture(old
                ? {kind:'credential-edit',id:old.id,provider:old.provider,fields,presence}
                : {kind:'credential-create',provider:form.provider.name,fields,presence});
            if (!token) return;
            pendingBody.current = body;
            const result = await config.run(token, () => {
            const entered = inputs.current.api_key?.value.trim();
            if (entered)
                body.api_key = entered;
            for (const key of privateFields) {
                const mode = form.modes[key] ?? 'keep';
                if (mode === 'clear')
                    body[key] = null;
                else if (mode === 'set') {
                    const value = inputs.current[key]?.value.trim();
                    if (!value)
                        return null;
                    body[key] = value;
                }
            }
            if (form.provider.name === 'anthropic_compatible' && (!old && (!entered || !body.base_url) || old && body.base_url === null))
                return null;
            if (!old && !['vertex', 'ollama', 'omlx', 'openai_compatible'].includes(form.provider.name) && !entered)
                return null;
                return body;
            });
            if (result) {
                if (alive.current && before === version.current)
                    config.store.setForm(row.id, null);
                await refresh();
            }
        }
        finally {
            for (const key of Object.keys(body) as (keyof CredentialWrite)[])
                delete body[key];
            if (pendingBody.current === body) pendingBody.current = null;
            if (alive.current && before === version.current) clear();
        }
    };
    return <LibraryDialog open onOpenChange={open => { if (!open)
        close(); }} title={form.credential ? t.apiKeys.editConfig : t.apiKeys.addConfig} description={m.privateHint}>
  <form className="configuration-editor" onSubmit={e => { e.preventDefault(); void submit(); }}>
   {stale && <p role="status">{m.stale}</p>}
   <fieldset disabled={config.locked || stale}>
    <label>{t.common.name}<input value={form.name} onChange={e => update({ name: e.target.value })}/></label>
    <p>{form.provider.display_name}</p>
    <label>{t.models.apiKey}<input ref={bindInput('api_key')} type={reveal ? 'text' : 'password'} autoComplete="off"/></label>
    <Button aria-label={reveal ? t.apiKeys.hideKeyLabel : t.apiKeys.showKeyLabel} onClick={() => setReveal(!reveal)}>{reveal ? t.apiKeys.hideKey : t.apiKeys.showKey}</Button>
    <p>{t.apiKeys.apiKeyEditHint}</p>
    <fieldset><legend>{t.models.modelType}</legend>{form.provider.modalities.map(type => <label key={type}><input type="checkbox" checked={form.modalities.includes(type)} onChange={e => update({ modalities: e.target.checked ? [...form.modalities, type] : form.modalities.filter(v => v !== type) })}/>{typeLabel(type)}</label>)}</fieldset>
    {visibleFields.map(key => <div className="configuration-field" key={key}>
     <label>{fieldLabel(key)}<select value={form.modes[key] ?? 'keep'} onChange={e => { if (inputs.current[key])
            inputs.current[key]!.value = ''; update({ modes: { ...form.modes, [key]: e.target.value as 'keep' | 'set' | 'clear' } }); }}>
      <option value="keep">{m.keep} ({oldPresence(form.credential?.presence[key], m)})</option>
      <option value="set">{m.set}</option>
      {form.credential && <option value="clear">{m.clear}</option>}
     </select></label>
     {form.modes[key] === 'set' && <label>{m.set}: {fieldLabel(key)}<input ref={bindInput(key)} type={key === 'credentials_path' ? 'text' : 'url'} autoComplete="off"/></label>}
    </div>)}
    {(['project', 'location', 'api_version'] as const).filter(key => key === 'api_version' ? form.provider.name === 'azure' : form.provider.name === 'vertex').map(key => <label key={key}>{key === 'project' ? t.apiKeys.vertexProject : key === 'location' ? t.apiKeys.vertexLocation : m.apiVersion}<input value={form[key]} onChange={e => update({ [key]: e.target.value })}/></label>)}
    {form.provider.name === 'ollama' && <label>{t.apiKeys.numCtx}<input type="number" min="0" value={form.num_ctx} onChange={e => update({ num_ctx: e.target.value })}/></label>}
    <Button type="submit" disabled={!form.name.trim()}>{m.saveConfiguration}</Button>
   </fieldset>
   <Button onClick={close}>{t.common.cancel}</Button>
  </form>
 </LibraryDialog>;
}
function oldPresence(value: string | undefined, m: {
    absent: string;
    present: string;
    empty: string;
}) {
    return value === 'present' ? m.present : value === 'null' ? m.empty : m.absent;
}
