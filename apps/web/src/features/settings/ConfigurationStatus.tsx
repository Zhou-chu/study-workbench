import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import type { ConfigurationController } from './use-configuration';
import type { ConfigurationIntent } from './configuration-store';
export function ConfigurationStatus({ config }: {
    config: ConfigurationController;
}) {
    const { t, configuration: m } = useI18n(), r = config.row;
    const labels: Record<string, string> = {
        default_chat_model: t.models.chatModelLabel, default_embedding_model: t.models.embeddingModelLabel,
        default_text_to_speech_model: t.models.ttsModelLabel, default_speech_to_text_model: t.models.sttModelLabel,
        default_transformation_model: t.models.transformationModelLabel, default_tools_model: t.models.toolsModelLabel,
        large_context_model: t.models.largeContextModelLabel,
        default_content_processing_engine_doc: t.settings.docEngine, default_content_processing_engine_url: t.settings.urlEngine,
        default_embedding_option: t.settings.defaultEmbeddingOption, auto_delete_files: t.settings.autoDeleteFiles,
        docling_ocr: t.settings.ocrEnabled, docling_formulas: t.settings.formulasEnabled, docling_vision: t.settings.visionEnabled,
        api_key: t.models.apiKey, base_url: t.apiKeys.baseUrl, credentials_path: t.apiKeys.vertexCredentials,
        name: t.common.name, project: t.apiKeys.vertexProject, location: t.apiKeys.vertexLocation,
        api_version: m.apiVersion, num_ctx: t.apiKeys.numCtx, modalities: t.models.modelType
    };
    const label = (key: string) => labels[key] ?? m.endpoint;
    const value = (v: unknown) => v === null ? t.models.noneOption : typeof v === 'boolean' ? v ? t.common.yes : t.common.no : String(v);
    const describe = (intent: ConfigurationIntent): {
        title: string;
        details: readonly string[];
    } => {
        switch (intent.kind) {
            case 'content': return { title: m.saveContent, details: Object.entries(intent.changes).map(([k, v]) => label(k) + ': ' + value(v)) };
            case 'defaults': return { title: label(intent.field), details: [value(intent.previousValue) + ' → ' + value(intent.value)] };
            case 'credential-create':
            case 'credential-edit': return {
                title: intent.kind === 'credential-create' ? t.apiKeys.addConfig : t.apiKeys.editConfig,
                details: [intent.provider, ...('id' in intent ? [intent.id] : []), ...intent.fields.map(key => label(key) + (intent.presence?.[key] ? ': ' + (intent.presence[key] === 'set' ? m.set : m.clear) : ''))]
            };
            case 'credential-test': return { title: t.apiKeys.testConnection, details: [intent.provider, intent.id] };
            case 'discover': return { title: t.models.discoverModels, details: [intent.provider, intent.id] };
            case 'register': return { title: m.register, details: [intent.id, ...intent.models.map(model => model.name + ' · ' + model.provider)] };
            case 'credential-delete': return {
                title: intent.migrateTo ? m.migrateDelete : t.apiKeys.deleteConfig,
                details: [intent.id, ...(intent.migrateTo ? [intent.migrateTo] : []), String(intent.modelCount ?? t.common.unknown), ...(intent.linkedModelIds ?? []), ...(intent.defaultSlots ?? []).map(label)]
            };
            case 'model-delete': return { title: t.models.deleteModel, details: [intent.id, ...(intent.defaultSlots ?? []).map(label)] };
            case 'model-test': return { title: t.models.testModel, details: [intent.id] };
            case 'migrate-env': return { title: t.apiKeys.migrateToDatabase, details: [] };
            case 'auto-assign': return { title: t.models.autoAssign, details: [] };
        }
    };
    const attempts = r ? [...r.history, ...(r.attempt ? [r.attempt] : [])] : [];
    return <>{r && <>
  <label>{m.records}<select value={r.id} onChange={e => config.select(e.target.value)}>
   {config.rows.map((row, index) => <option key={row.id} value={row.id}>{index + 1}: {row.retired ? t.common.unknown : row.kind === 'models' ? t.navigation.models : t.navigation.settings}</option>)}
  </select></label>
  {r.retired && <p role="status">{m.retired}<Button disabled={!config.context?.ready} onClick={config.fresh}>{m.fresh}</Button></p>}
  {r.status === 'pending' && <p role="status">{t.common.loading}</p>}
  {r.status === 'unknown' && <p className="settings-danger" role="alert">{m.unknown}</p>}
  {r.attempt?.phase === 'not-sent' && <p role="status">{t.noteConflict.notSent}</p>}
  {r.attempt?.phase === 'confirmed' && <p role="status">{r.attempt.result?.success === false ? t.apiKeys.testFailed : t.common.success}</p>}
  {r.attempt?.httpStatus !== undefined && <p role="status">{t.common.error}: {r.attempt.httpStatus}</p>}
  {attempts.length > 0 && <details><summary>{m.records}</summary><ol>{attempts.map(attempt => {
                    const description = describe(attempt.token.intent);
                    return <li key={attempt.token.id}><strong>{description.title}</strong><ul>{description.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul></li>;
                })}</ol></details>}
 </>}</>;
}
