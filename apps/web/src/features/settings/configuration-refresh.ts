import { canDispatch, type DispatchContext } from '@study/domain';
import type { SettingsApi } from '../../data/settings-api';
import type { SourceName, Sources } from '../../data/configuration-contracts';
import type { ConfigurationDraft, createConfigurationStore } from './configuration-store';

type ReadApi = Pick<SettingsApi, 'contentSettings' | 'extractionCapabilities' | 'webSearchStatus' | 'providers' | 'credentialsMetadata' | 'models' | 'modelDefaults'>;
type ReadStore = Pick<ReturnType<typeof createConfigurationStore>, 'loading' | 'publish'> & {
    get(id: string): Pick<ConfigurationDraft, 'retired' | 'context'> | undefined;
};
type ReadRuntime = Readonly<{
    ready(): boolean;
    context(): DispatchContext | null;
    generation(): number;
}>;

/** One owner-bound batch of independent configuration reads. */
export async function refreshConfigurationSources(
    id: string | null, names: readonly SourceName[], api: ReadApi | null,
    store: ReadStore, runtime: ReadRuntime,
): Promise<boolean> {
    if (!id || !api || !runtime.ready())
        return false;
    const r = store.get(id), c = runtime.context(), g = runtime.generation();
    if (!r || r.retired || !canDispatch(r.context, c))
        return false;
    const reads: {
        [K in SourceName]: () => Promise<Sources[K]>;
    } = {
        content: () => api.contentSettings(r.context), capabilities: () => api.extractionCapabilities(r.context),
        web: () => api.webSearchStatus(r.context), providers: () => api.providers(r.context),
        credentials: () => api.credentialsMetadata(r.context), models: () => api.models(r.context), defaults: () => api.modelDefaults(r.context)
    };
    const results = await Promise.all(names.map(async (name) => {
        const revision = store.loading(id, name);
        if (revision === null)
            return false;
        try {
            const value = await reads[name]();
            if (g !== runtime.generation() || !canDispatch(r.context, runtime.context()))
                return false;
            store.publish(id, name, revision, value);
            return true;
        }
        catch {
            store.publish(id, name, revision, null);
            return false;
        }
    }));
    return results.every(Boolean);
}
