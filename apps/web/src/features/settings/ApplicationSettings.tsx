import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { contentChoices, contentKeys, validContent, type ContentKey } from '../../data/configuration-contracts';
import { useConfiguration } from './use-configuration';
import { ConfigurationStatus } from './ConfigurationStatus';
export function ApplicationSettings() {
    const config = useConfiguration('application'), { row } = config;
    const { t, configuration: m } = useI18n(), location = useLocation(), web = useRef<HTMLElement>(null);
    useEffect(() => { if (location.hash === '#web-search')
        web.current?.focus(); }, [location.hash]);
    const labels: Record<ContentKey, string> = {
        default_content_processing_engine_doc: t.settings.docEngine, default_content_processing_engine_url: t.settings.urlEngine,
        default_embedding_option: t.settings.defaultEmbeddingOption, auto_delete_files: t.settings.autoDeleteFiles,
        docling_ocr: t.settings.ocrEnabled, docling_formulas: t.settings.formulasEnabled, docling_vision: t.settings.visionEnabled
    };
    const value = (key: ContentKey) => Object.hasOwn(row?.fields ?? {}, key) ? row?.fields[key] : row?.data.content?.[key];
    const options: Record<string, string> = { auto: t.settings.autoRecommended, docling: t.settings.docling, simple: t.settings.simple, firecrawl: t.settings.firecrawl, jina: t.settings.jina, crawl4ai: t.settings.crawl4ai, ask: t.settings.ask, always: t.settings.always, never: t.settings.never, yes: t.common.yes, no: t.common.no };
    const capability = (key: ContentKey, choice: unknown) => {
        const caps = row?.sources.capabilities?.phase === 'ready' ? row.data.capabilities : undefined;
        if (choice === 'docling' || key.startsWith('docling_'))
            return caps?.docling_available === true;
        if (choice === 'crawl4ai')
            return caps?.crawl4ai_available === true;
        return true;
    };
    const save = async () => {
        if (!row || config.locked || row.sources.content?.phase !== 'ready')
            return;
        const changes = Object.fromEntries(contentKeys.filter(k => Object.hasOwn(row.fields, k) && row.fields[k] !== row.data.content?.[k]).map(k => [k, row.fields[k]]));
        if (!Object.keys(changes).length || Object.entries(changes).some(([key, v]) => !validContent(key as ContentKey, v) || !capability(key as ContentKey, v)))
            return;
        const token = config.capture({ kind: 'content', changes });
        if (token)
            await config.run(token);
    };
    const status = row?.data.web;
    return <section className="configuration-page">
  <h2>{t.settings.contentProcessing}</h2><ConfigurationStatus config={config}/>
  <Button disabled={!config.ready} onClick={() => void config.refresh(['content', 'capabilities', 'web'])}>{t.common.refresh}</Button>
  {row?.sources.capabilities?.phase === 'error' && <p role="alert">{t.common.error}: {t.settings.docEngine}</p>}
  {row?.sources.content?.phase === 'error' && <p role="alert">{t.settings.loadFailed}</p>}
  {!row?.data.content ? <p role="status">{t.common.loading}</p> : <fieldset disabled={!config.ready}>
   {contentKeys.map(key => <div className="configuration-field" key={key}>
    {key.startsWith('docling_') ? <label><input type="checkbox" checked={value(key) === true} disabled={!capability(key, true)} onChange={e => config.store.edit(row.id, key, e.target.checked)}/>{labels[key]}{typeof value(key) !== 'boolean' && <span> · {t.common.unknown}</span>}</label> :
                    <label>{labels[key]}<select value={typeof value(key) === 'string' ? String(value(key)) : ''} onChange={e => config.store.edit(row.id, key, e.target.value)}>
     <option value="" disabled>{t.common.unknown}</option>
     {typeof value(key) === 'string' && !validContent(key, value(key)) && <option value={String(value(key))} disabled>{t.common.unknown}: {String(value(key))}</option>}
     {(contentChoices[key as keyof typeof contentChoices] as readonly string[]).map(choice => <option key={choice} value={choice} disabled={!capability(key, choice)}>{options[choice]}</option>)}
    </select></label>}
   </div>)}
   <details><summary>{t.settings.helpMeChoose}</summary><p>{t.settings.docHelp}</p><p>{t.settings.urlHelp}</p><p>{t.settings.ocrHelp}</p><p>{t.settings.formulasHelp}</p><p>{t.settings.visionHelp}</p></details>
   <p>{m.future}</p>
   <Button disabled={config.locked || !row.dirty} onClick={() => void save()}>{m.saveContent}</Button>
  </fieldset>}
  <section ref={web} id="web-search" tabIndex={-1}>
   <h2>{m.web}</h2>
   {row?.sources.web?.phase === 'loading' ? <p role="status">{t.common.loading}</p> : row?.sources.web?.phase === 'error' ? <p role="alert">{t.common.error}</p> : status && <p>{status.state === 'ready' && status.configured ? m.ready : status.state === 'configuration_required' ? t.apiKeys.notConfigured : t.common.unknown}</p>}
   {status?.access_mode === 'keyless_trial' && <p>{m.trial}</p>}
   <p>{m.webCaveat}</p>
   <Button disabled={!config.ready || row?.sources.web?.phase === 'loading'} onClick={() => void config.refresh(['web'])}>{m.retryWeb}</Button>
  </section>
 </section>;
}
