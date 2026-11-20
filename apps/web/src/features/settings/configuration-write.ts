import { RequestNotDispatchedError, asRequestNotDispatchedError, type DispatchContext } from '@study/web-transport';
import { SettingsRequestError, type SettingsApi } from '../../data/settings-api';
import type { CredentialWrite } from '../../data/configuration-contracts';
import type { ConfigurationToken, createConfigurationStore } from './configuration-store';

type WriteApi = Pick<SettingsApi, 'saveContentSettings' | 'saveModelDefault' | 'saveCredential' | 'testCredential' |
    'discoverCredentialModels' | 'registerCredentialModels' | 'deleteCredential' | 'deleteModel' | 'testModel' |
    'migrateEnvironment' | 'autoAssignDefaults'>;
type WriteStore = Pick<ReturnType<typeof createConfigurationStore>, 'begin' | 'settle'>;
type WriteRuntime = Readonly<{
    ready(): boolean;
    context(): DispatchContext | null;
    generation(): number;
    providerRevision(): number;
}>;

export async function runConfigurationWrite(
    token: ConfigurationToken, api: WriteApi | null, store: WriteStore, runtime: WriteRuntime,
    takePrivateBody?: () => CredentialWrite | null,
): Promise<Readonly<Record<string, unknown>> | null> {
    if (!api || !runtime.ready() || !store.begin(token, runtime.context(), runtime.generation(), runtime.providerRevision()))
        return null;
    const c = token.context, k = token.id, i = token.intent;
    try {
        let result: Readonly<Record<string, unknown>>;
        switch (i.kind) {
            case 'content':
                result = await api.saveContentSettings(i.changes, c, k);
                break;
            case 'defaults':
                result = await api.saveModelDefault(i.field, i.value, c, k);
                break;
            case 'credential-create':
            case 'credential-edit': {
                const privateBody = takePrivateBody?.();
                if (!privateBody)
                    throw new RequestNotDispatchedError('configuration');
                result = await api.saveCredential(i.kind === 'credential-edit' ? i.id : null, privateBody, c, k);
                break;
            }
            case 'credential-test':
                result = await api.testCredential(i.id, c, k);
                break;
            case 'discover':
                result = await api.discoverCredentialModels(i.id, i.provider, c, k);
                break;
            case 'register':
                result = await api.registerCredentialModels(i.id, i.models, c, k);
                break;
            case 'credential-delete':
                result = await api.deleteCredential(i.id, i.migrateTo, c, k);
                break;
            case 'model-delete':
                result = await api.deleteModel(i.id, c, k);
                break;
            case 'model-test':
                result = await api.testModel(i.id, c, k);
                break;
            case 'migrate-env':
                result = await api.migrateEnvironment(c, k);
                break;
            case 'auto-assign':
                result = await api.autoAssignDefaults(c, k);
                break;
        }
        if (i.kind === 'migrate-env' && typeof result.errors === 'number' && result.errors > 0) {
            store.settle(token, 'unknown', runtime.context(), runtime.generation(), result);
            return null;
        }
        const confirmed = store.settle(token, 'confirmed', runtime.context(), runtime.generation(), result);
        return confirmed ? result : null;
    }
    catch (error) {
        store.settle(token, asRequestNotDispatchedError(error) ? 'not-sent' : 'unknown', runtime.context(), runtime.generation(), undefined, error instanceof SettingsRequestError ? error.status : undefined);
        return null;
    }
}
