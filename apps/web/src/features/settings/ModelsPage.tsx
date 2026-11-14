import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { canDispatch, readTurnContext, sessionCoordinator } from '@study/web-transport';
import { AppChrome } from '../../app/AppChrome';
import { useI18n } from '../../i18n';
import { modelSetupCopy } from '../../i18n/model-setup-messages';
import { settingsControlCopy } from '../../i18n/settings-control-messages';
import { Button } from '../../ui/Button';
import { LibraryDialog } from '../library/LibraryDialog';
import { supportedProviders, defaultKeys, defaultTypes, modelTypes, requiredDefaults, type Credential, type DefaultKey, type Discovery, type Provider, type Registration } from '../../data/configuration-contracts';
import type { ConfigurationIntent, ConfigurationToken } from './configuration-store';
import { useConfiguration } from './use-configuration';
import { ConfigurationStatus } from './ConfigurationStatus';
import { CredentialEditor } from './CredentialEditor';
import { credentialSetupAnchor, CredentialSetupHint, ModelCredentialLink, ModelSetupGuide } from './ModelSetupGuide';
import { useSetupMetadata } from './SetupWarning';
export function ModelsPage() {
    const config = useConfiguration('models'), { row } = config, setup = useSetupMetadata();
    const { t, configuration: m, locale } = useI18n(), navigate = useNavigate(), location = useLocation();
    const [confirm, setConfirm] = useState<ConfigurationToken | null>(null);
    const [migrateTo, setMigrateTo] = useState('');
    const [viewResult, setViewResult] = useState(false);
    const mounted = useRef(false), intentRevision = useRef(0), route = useRef(location.key);
    route.current = location.key;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; intentRevision.current++; }; }, []);
    useEffect(() => config.navigation?.subscribe(() => { intentRevision.current++; }), [config.navigation]);
    useEffect(() => {
        if (row)
            config.store.invalidate(row.id);
    }, [row?.id, setup.data, setup.isPending, setup.isError, config.store]);
    const touch = () => { intentRevision.current++; if (row)
        config.store.touch(row.id); };
    const copy = settingsControlCopy(locale), journeyCopy = modelSetupCopy(locale);
    const credentialReady = !!row && (['providers', 'credentials'] as const).every(k => row.sources[k]?.phase === 'ready') && !setup.isPending && !setup.isError && !!setup.data;
    const complete = !!row && (['providers', 'credentials', 'models', 'defaults'] as const).every(k => row.sources[k]?.phase === 'ready') && !setup.isPending && !setup.isError && !!setup.data;
    const currentComplete = () => {
        const r = row && config.store.get(row.id);
        return !!r && (['providers', 'credentials', 'models', 'defaults'] as const).every(k => r.sources[k]?.phase === 'ready') && !setup.isPending && !setup.isError && !!setup.data;
    };
    const refresh = async () => {
        await config.refresh(['providers', 'credentials', 'models', 'defaults']);
        await setup.refetch();
    };
    const credentials = row?.data.credentials ?? [], models = row?.data.models ?? [], defaults = row?.data.defaults;
    const providers = [...(row?.data.providers ?? [])].sort((a, b) => Number(credentials.some(c => c.provider === b.name)) - Number(credentials.some(c => c.provider === a.name)));
    const knownProvider = (p: Provider) => (supportedProviders as readonly string[]).includes(p.name) && p.modalities.length > 0 && p.modalities.every(type => (modelTypes as readonly string[]).includes(type));
    const close = () => { touch(); setConfirm(null); setMigrateTo(''); };
    const queue = (intent: ConfigurationIntent) => {
        if (config.locked || !currentComplete())
            return;
        touch();
        setMigrateTo('');
        const token = config.capture(intent);
        if (token)
            setConfirm(token);
    };
    const editor = (provider: Provider, credential: Credential | null) => {
        if (!row || config.locked || !(credential ? complete : credentialReady) || !setup.data?.encryption_configured || !knownProvider(provider) || credential?.decryption_problem)
            return;
        touch();
        config.store.setForm(row.id, {
            identity: crypto.randomUUID(), credentialRevision: row.sources.credentials!.revision, provider, credential, name: credential?.name ?? '',
            modalities: credential?.modalities ?? provider.modalities, project: credential?.project ?? '',
            location: credential?.location ?? '', api_version: credential?.api_version ?? '',
            num_ctx: credential?.num_ctx === null || credential?.num_ctx === undefined ? '' : String(credential.num_ctx), modes: {}
        });
    };
    const deletion = async (credential: Credential) => {
        touch();
        const revision = intentRevision.current, owner = row?.id;
        if (!await config.refresh(['credentials', 'models', 'defaults']))
            return;
        if (!mounted.current || intentRevision.current !== revision || row?.id !== owner || config.locked)
            return;
        const token = config.capture({ kind: 'credential-delete', id: credential.id, migrateTo: null });
        if (token) {
            setMigrateTo('');
            setConfirm(token);
        }
    };
    const defaultChange = (field: DefaultKey, value: string) => {
        if (!complete || !defaults)
            return;
        const id = value || null;
        if (id === null && requiredDefaults.includes(field))
            return;
        if (id !== null && !models.some(model => model.id === id && model.type === defaultTypes[field]))
            return;
        queue({ kind: 'defaults', field, value: id });
    };
    const admissible = (token: ConfigurationToken) => {
        if (!config.valid(token) || !currentComplete())
            return false;
        const i = token.intent, r = config.store.get(token.ownerId)!, cs = r.data.credentials!, ms = r.data.models!;
        if (i.kind === 'defaults')
            return i.value === null ? !requiredDefaults.includes(i.field) : ms.some(model => model.id === i.value && model.type === defaultTypes[i.field]);
        if (i.kind === 'credential-delete') {
            const credential = cs.find(c => c.id === i.id);
            if (!credential)
                return false;
            if (i.migrateTo !== null)
                return cs.some(c => c.id === i.migrateTo && c.id !== i.id && c.provider === credential.provider && !c.decryption_problem);
            return true;
        }
        if (i.kind === 'discover' || i.kind === 'credential-test')
            return cs.some(c => c.id === i.id && c.provider === i.provider && !c.decryption_problem);
        if (i.kind === 'model-test' || i.kind === 'model-delete')
            return ms.some(model => model.id === i.id && (modelTypes as readonly string[]).includes(model.type));
        if (i.kind === 'migrate-env')
            return setup.data?.encryption_configured === true;
        return true;
    };
    const submit = async (openAdvanced = false) => {
        const token = confirm;
        if (!token || !admissible(token))
            return;
        const ticket = { revision: intentRevision.current, location: route.current, owner: token.ownerId };
        setConfirm(null);
        setMigrateTo('');
        const result = await config.run(token);
        if (!result)
            return;
        const r = config.store.get(token.ownerId);
        if (openAdvanced && token.intent.kind === 'defaults' && mounted.current && route.current === ticket.location && intentRevision.current === ticket.revision && r?.id === ticket.owner && !r.retired && r.revision === token.controlRevision && r.metadataRevision === token.metadataRevision + 2 && sessionCoordinator.current() === token.generation && config.controller?.getSnapshot().providerEvidenceRevision === token.providerRevision && canDispatch(token.context, readTurnContext())) {
            intentRevision.current++;
            void navigate('/advanced');
        }
        if (token.intent.kind === 'discover') {
            const discovery = result as Discovery;
            const c = r?.data.credentials?.find(v => v.id === discovery.credential_id);
            const first = c?.modalities[0] ?? 'language';
            if (r)
                config.store.setDiscovery(r.id, { value: discovery, credentialRevision: r.sources.credentials!.revision, type: (modelTypes as readonly string[]).includes(first) ? first : '', search: '', selected: [], custom: false });
        }
        else if (token.intent.kind === 'model-test' || token.intent.kind === 'credential-test') {
            if (mounted.current)
                setViewResult(true);
        }
        else if (!['content'].includes(token.intent.kind))
            await refresh();
    };
    const discovery = row?.discovery;
    const discoveryCurrent = !!discovery && row?.sources.credentials?.phase === 'ready' && row.sources.credentials.revision === discovery.credentialRevision;
    const typeLabel = (type: string) => ({ language: t.common.language, embedding: t.models.embedding, text_to_speech: t.models.tts, speech_to_text: t.models.stt }[type] ?? t.common.unknown + ': ' + type);
    const filtered = discovery?.value.discovered.filter(model => model.name.toLowerCase().includes(discovery.search.toLowerCase())) ?? [];
    const custom = !!discovery?.search.trim() && !discovery.value.discovered.some(model => model.name.toLowerCase() === discovery.search.trim().toLowerCase());
    const updateDiscovery = (patch: Partial<NonNullable<typeof discovery>>) => {
        if (row && discovery) {
            touch();
            config.store.setDiscovery(row.id, { ...discovery, ...patch });
        }
    };
    const register = async () => {
        if (!row || !discovery || !discoveryCurrent || config.locked || !complete || !(modelTypes as readonly string[]).includes(discovery.type))
            return;
        const credential = credentials.find(c => c.id === discovery.value.credential_id && !c.decryption_problem && c.provider === discovery.value.provider);
        if (!credential)
            return;
        const names = discovery.value.discovered.filter(model => discovery.selected.includes(model.name)).map(model => model.name);
        if (discovery.custom && custom)
            names.push(discovery.search.trim());
        const seen = new Set<string>();
        const selected: Registration[] = names.filter(name => { const key = name.toLowerCase() + '\u0000' + discovery.type; if (seen.has(key))
            return false; seen.add(key); return true; }).map(name => ({ name, provider: credential.provider, model_type: discovery.type as Registration['model_type'] }));
        if (!selected.length)
            return;
        const token = config.capture({ kind: 'register', id: credential.id, models: Object.freeze(selected) });
        if (token && await config.run(token))
            await refresh();
    };
    const labels: Record<DefaultKey, string> = {
        default_chat_model: t.models.chatModelLabel, default_embedding_model: t.models.embeddingModelLabel,
        default_text_to_speech_model: t.models.ttsModelLabel, default_speech_to_text_model: t.models.sttModelLabel,
        default_transformation_model: t.models.transformationModelLabel, default_tools_model: t.models.toolsModelLabel,
        large_context_model: t.models.largeContextModelLabel
    };
    const deleting = confirm?.intent.kind === 'credential-delete' ? credentials.find(c => c.id === (confirm.intent as {
        id: string;
    }).id) : undefined;
    const links = deleting ? models.filter(model => model.credential === deleting.id) : [];
    const zero = !!deleting && complete && deleting.model_count === 0 && links.length === 0;
    const affected = defaultKeys.filter(key => links.some(model => model.id === defaults?.[key]));
    const result = row?.attempt?.result;
    const guideCurrent = config.ready && !config.locked;
    return <AppChrome><section className="notebook-home configuration-page">
  <h1>{t.navigation.models}</h1><ConfigurationStatus config={config}/>
  <ModelSetupGuide row={row} current={guideCurrent} navigationReady={complete} canAddConfiguration={setup.data?.encryption_configured === true} supportedProviderNames={providers.filter(knownProvider).map(p => p.name)} testCurrent={!!row && config.ready && complete && !!row.attempt &&
    row.metadataRevision === row.attempt.token.metadataRevision + 2 &&
    sessionCoordinator.current() === row.attempt.token.generation &&
    config.controller?.getSnapshot().providerEvidenceRevision === row.attempt.token.providerRevision}/>
  <div id="model-setup-status" tabIndex={-1}>
  <Button disabled={!config.ready} onClick={() => void refresh()}>{t.common.refresh}</Button>
  {!complete && <section aria-label={copy.retry}>
   {(['providers', 'credentials', 'models', 'defaults'] as const).filter(key => row?.sources[key]?.phase !== 'ready').map(key => <p key={key} role={row?.sources[key]?.phase === 'error' ? 'alert' : 'status'}>{row?.sources[key]?.phase === 'error' ? copy.failed : copy.loading}: {copy[key]}</p>)}
   {(setup.isPending || setup.isError) && <p role={setup.isError ? 'alert' : 'status'}>{setup.isError ? copy.failed : copy.loading}: {copy.setup}</p>}
   <p>{copy.dependent}</p>
   <Button disabled={!config.ready} onClick={() => void refresh()}>{copy.retry}</Button>
  </section>}
  {setup.data && !setup.data.encryption_configured && <p role="alert">{t.apiKeys.encryptionRequired}</p>}
  </div>
  <p>{m.providerRisk}</p>
  <Button disabled={config.locked || !complete || !setup.data?.encryption_configured} onClick={() => queue({ kind: 'migrate-env' })}>{t.apiKeys.migrateToDatabase}</Button>
  <div id="model-setup-providers" tabIndex={-1}>
  {providers.map(provider => <section key={provider.name} className="configuration-provider">
   <h2>{provider.display_name}</h2><p>{provider.modalities.map(typeLabel).join(' · ')}</p>
   {provider.docs_url && <a href={provider.docs_url} target="_blank" rel="noopener noreferrer">{t.setupBanner.viewDocs}</a>}
   <Button disabled={!credentialReady || config.locked || !setup.data?.encryption_configured || !knownProvider(provider)} onClick={() => editor(provider, null)}>{t.apiKeys.addConfig}: {provider.display_name}</Button>
   {!knownProvider(provider) && <p role="status">{copy.unsupported}</p>}
   {credentials.filter(c => c.provider === provider.name).map(c => <article key={c.id} id={credentialSetupAnchor(c.id)} tabIndex={-1}>
    <h3>{c.name}</h3><p>{c.modalities.map(typeLabel).join(' · ')} · {c.model_count}</p>
    <CredentialSetupHint row={guideCurrent ? row : undefined} credential={c}/>
    {c.decryption_problem && <p role="alert">{t.apiKeys.decryptionError}</p>}
    <div className="dialog-actions">
     <Button aria-label={t.common.edit + ' ' + c.name} disabled={!complete || config.locked || c.decryption_problem || !setup.data?.encryption_configured || !knownProvider(provider)} onClick={() => editor(provider, c)}>{t.common.edit}</Button>
     <Button aria-label={t.apiKeys.testConnection + ' ' + c.name} disabled={!complete || config.locked || c.decryption_problem || !knownProvider(provider)} onClick={() => queue({ kind: 'credential-test', id: c.id, provider: c.provider })}>{t.apiKeys.testConnection}</Button>
     <Button aria-label={t.models.discoverModels + ' ' + c.name} disabled={!complete || config.locked || c.decryption_problem || !knownProvider(provider)} onClick={() => queue({ kind: 'discover', id: c.id, provider: c.provider })}>{t.models.discoverModels}</Button>
     <Button aria-label={t.common.delete + ' ' + c.name} disabled={!complete || config.locked} onClick={() => void deletion(c)}>{t.common.delete}</Button>
    </div>
   </article>)}
  </section>)}
  {credentials.filter(c => !providers.some(p => p.name === c.provider)).map(c => <p key={c.id}>{c.name}: {t.common.unknown} ({c.provider})</p>)}
  </div>
  <section id="model-default-assignments" tabIndex={-1}><h2>{t.models.defaultAssignments}</h2>
   {defaultKeys.map(field => <label key={field}>{labels[field]}<select disabled={!complete || config.locked} value={defaults?.[field] ?? ''} onChange={e => defaultChange(field, e.target.value)}>
    <option value="" disabled={requiredDefaults.includes(field)}>{requiredDefaults.includes(field) ? t.models.requiredModelPlaceholder : ['default_text_to_speech_model', 'default_speech_to_text_model'].includes(field) ? t.models.noneOption : t.models.noneFallbackToChat}</option>
    {defaults?.[field] && !models.some(model => model.id === defaults[field] && model.type === defaultTypes[field]) && <option value={defaults[field]!} disabled>{t.common.unknown}: {defaults[field]}</option>}
    {models.filter(model => model.type === defaultTypes[field]).map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
   </select>{!defaults?.[field] && field === 'default_text_to_speech_model' && <span>{t.models.ttsUnsetHint}</span>}{!defaults?.[field] && field === 'default_speech_to_text_model' && <span>{t.models.sttUnsetHint}</span>}</label>)}
   <Button disabled={!complete || config.locked} onClick={() => queue({ kind: 'auto-assign' })}>{t.models.autoAssign}</Button>
  </section>
  <section id="registered-models" tabIndex={-1}><h2>{t.navigation.models}</h2>{models.map(model => <article key={model.id}>
   <h3>{model.name}</h3><p>{model.provider} · {typeLabel(model.type)}</p>
   <ModelCredentialLink row={guideCurrent ? row : undefined} model={model}/>
   <Button aria-label={t.models.testModel + ' ' + model.name} disabled={!complete || config.locked || !(modelTypes as readonly string[]).includes(model.type)} onClick={() => queue({ kind: 'model-test', id: model.id })}>{t.models.testModel}</Button>
   <Button aria-label={t.common.delete + ' ' + model.name} disabled={!complete || config.locked || !(modelTypes as readonly string[]).includes(model.type)} onClick={() => queue({ kind: 'model-delete', id: model.id })}>{t.common.delete}</Button>
  </article>)}</section>
  {discovery && <section><h2>{t.models.discoverModels}: {discovery.value.provider}</h2>
   {!discoveryCurrent && <p role="status">{m.stale}</p>}
   {!discovery.value.discovered.length && <p>{m.emptyDiscovery}</p>}
   <p>{t.models.modelTypeHint}</p>
   <label>{t.models.modelType}<select value={discovery.type} onChange={e => updateDiscovery({ type: e.target.value })}><option value="" disabled>{t.common.unknown}</option>{modelTypes.map(type => <option key={type} value={type}>{typeLabel(type)}</option>)}</select></label>
   <label>{t.common.search}<input value={discovery.search} onChange={e => updateDiscovery({ search: e.target.value, custom: false })}/></label>
   <Button onClick={() => { const names = filtered.map(model => model.name), all = names.every(name => discovery.selected.includes(name)); updateDiscovery({ selected: all ? discovery.selected.filter(name => !names.includes(name)) : [...new Set([...discovery.selected, ...names])] }); }}>{m.toggleFiltered}</Button>
   {filtered.map(model => <label key={model.name}><input type="checkbox" checked={discovery.selected.includes(model.name)} onChange={e => updateDiscovery({ selected: e.target.checked ? [...discovery.selected, model.name] : discovery.selected.filter(name => name !== model.name) })}/>{model.name}</label>)}
   {custom && <label><input type="checkbox" checked={discovery.custom} onChange={e => updateDiscovery({ custom: e.target.checked })}/>{t.models.addCustomModel.replace('{{name}}', discovery.search.trim())}</label>}
   <Button disabled={config.locked || !complete || !discoveryCurrent} onClick={() => void register()}>{m.register}</Button>
  </section>}
  {result && <dl>{(['created', 'existing', 'deleted_models', 'migrated', 'skipped', 'not_configured', 'errors'] as const).filter(key => typeof result[key] === 'number').map(key => <div key={key}><dt>{m.counts[key]}</dt><dd>{String(result[key])}</dd></div>)}</dl>}
  {result && typeof result.assigned === 'object' && result.assigned !== null && <dl>{(['assigned', 'skipped', 'missing'] as const).map(key => <div key={key}><dt>{m.counts[key]}</dt><dd>{Object.entries(result[key] as object).map(([name, value]) => labels[(key === 'assigned' ? name : value) as DefaultKey] ?? t.common.unknown).join(' · ') || t.models.noneOption}</dd></div>)}</dl>}
  <Link className="button" to="/advanced">{m.openAdvanced}</Link>
  <CredentialEditor config={config} refresh={refresh} enabled={(row?.form?.credential ? complete : credentialReady) && setup.data?.encryption_configured === true}/>
  {confirm && <LibraryDialog open onOpenChange={open => { if (!open)
            close(); }} title={m.confirm} description={deleting ? m.deleteRisk : m.providerRisk}>
   {(confirm.intent.kind === 'credential-test' || confirm.intent.kind === 'discover') && <p>{credentials.find(c => c.id === (confirm.intent as {id:string}).id)?.name ?? t.common.unknown} · {confirm.intent.provider} · {confirm.intent.id}</p>}
   {(confirm.intent.kind === 'model-test' || confirm.intent.kind === 'model-delete') && <p>{models.find(model => model.id === (confirm.intent as {id:string}).id)?.name ?? t.common.unknown} · {models.find(model => model.id === (confirm.intent as {id:string}).id)?.provider ?? t.common.unknown} · {confirm.intent.id}</p>}
   {confirm.intent.kind === 'migrate-env' && <p>{t.apiKeys.migrateToDatabase}: {Object.keys(setup.data?.environment ?? {}).filter(provider => setup.data?.environment[provider]).join(' · ') || t.models.noneOption}</p>}
   {confirm.intent.kind === 'auto-assign' && <p>{t.models.autoAssign}: {requiredDefaults.map(field => labels[field]).join(' · ')}</p>}
   {confirm.intent.kind === 'defaults' && confirm.intent.field === 'default_embedding_model' && <p>{t.models.rebuildReason} {t.models.step2}</p>}
   {confirm.intent.kind === 'defaults' && <p>{labels[confirm.intent.field]}: {defaults?.[confirm.intent.field] ?? t.common.unknown} → {confirm.intent.value ?? t.models.noneOption}</p>}
   {deleting && <>
    <p>{deleting.name}: {deleting.model_count} · {links.length}</p><p>{affected.map(key => labels[key]).join(' · ')}</p>
    <label>{m.migrateTo}<select value={migrateTo} onChange={e => {
                    const value = e.target.value;
                    touch();
                    setMigrateTo(value);
                    const token = config.capture({ kind: 'credential-delete', id: deleting.id, migrateTo: value || null });
                    setConfirm(token);
                }}><option value="">{t.models.noneOption}</option>{credentials.filter(c => c.id !== deleting.id && c.provider === deleting.provider && !c.decryption_problem).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   </>}
   {confirm.intent.kind === 'model-delete' && <p>{defaultKeys.filter(key => defaults?.[key] === (confirm.intent as {
            id: string;
        }).id).map(key => labels[key]).join(' · ')}</p>}
   <Button variant="danger" disabled={!admissible(confirm)} onClick={() => void submit()}>{deleting ? migrateTo ? m.migrateDelete : zero ? t.common.delete : m.deleteWithModels : m.confirm}</Button>
   {confirm.intent.kind === 'defaults' && confirm.intent.field === 'default_embedding_model' && <Button disabled={!admissible(confirm)} onClick={() => void submit(true)}>{m.confirmAdvanced}</Button>}
   <Button onClick={close}>{t.common.cancel}</Button>
  </LibraryDialog>}
  {viewResult && <LibraryDialog open onOpenChange={setViewResult} title={result?.success === true ? journeyCopy.received : journeyCopy.failed} description={m.safeDetails + ' ' + journeyCopy.testLimit}>{null}</LibraryDialog>}
 </section></AppChrome>;
}
