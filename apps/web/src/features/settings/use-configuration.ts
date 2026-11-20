import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { RequestNotDispatchedError, asRequestNotDispatchedError, canDispatch, readTurnContext, sessionCoordinator, subscribeTurnContext } from '@study/web-transport';
import { useAppData, useAppDrafts } from '../../app/providers';
import { useResourceNavigation, useWorkbenchSnapshot } from '../../app/WorkbenchSession';
import { createSettingsApi, SettingsRequestError } from '../../data/settings-api';
import type { CredentialWrite, SourceName } from '../../data/configuration-contracts';
import { refreshConfigurationSources } from './configuration-refresh';
import type { ConfigurationKind, ConfigurationToken } from './configuration-store';
export function useConfiguration(kind: ConfigurationKind) {
    const drafts = useAppDrafts(), store = drafts.configuration;
    const rows = useSyncExternalStore(drafts.subscribe, store.getSnapshot);
    const context = useSyncExternalStore(subscribeTurnContext, readTurnContext, () => null);
    const { state, controller } = useWorkbenchSnapshot(), { transport } = useAppData();
    const api = useMemo(() => transport ? createSettingsApi(transport) : null, [transport]);
    const navigation = useResourceNavigation();
    const [id, setId] = useState<string | null>(null);
    useEffect(() => { if (!id && context?.ready && state?.ready)
        setId(store.open(kind, context)); }, [id, context, kind, state?.ready, store]);
    const row = rows.find(r => r.id === id);
    useEffect(() => { if (!id)
        return; navigation?.activateResource(id); return navigation?.holdResource(id); }, [navigation, id]);
    const ready = !!row && !row.retired && !!api && state?.ready === true && canDispatch(row.context, context);
    const refresh = useCallback((names: readonly SourceName[]) => refreshConfigurationSources(id, names, api, store, {
        ready: () => controller?.getSnapshot().ready === true,
        context: readTurnContext,
        generation: () => sessionCoordinator.current(),
    }), [id, api, controller, store]);
    useEffect(() => {
        if (!id || !ready)
            return;
        const names: SourceName[] = kind === 'application' ? ['content', 'capabilities', 'web'] : ['providers', 'credentials', 'models', 'defaults'];
        const missing = names.filter(name => !store.get(id)?.sources[name]);
        if (missing.length)
            void refresh(missing);
    }, [id, ready, kind, refresh, store]);
    const capture = (intent: ConfigurationToken['intent']) => {
        if (!id || !controller?.getSnapshot().ready)
            return null;
        return store.capture(id, intent, readTurnContext(), sessionCoordinator.current(), controller.getSnapshot().providerEvidenceRevision);
    };
    const valid = (token: ConfigurationToken) => controller?.getSnapshot().ready === true && store.canBegin(token, readTurnContext(), sessionCoordinator.current(), controller.getSnapshot().providerEvidenceRevision);
    const run = async (token: ConfigurationToken, takePrivateBody?: () => CredentialWrite | null) => {
        if (!api || !controller?.getSnapshot().ready || !store.begin(token, readTurnContext(), sessionCoordinator.current(), controller.getSnapshot().providerEvidenceRevision))
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
                store.settle(token, 'unknown', readTurnContext(), sessionCoordinator.current(), result);
                return null;
            }
            const confirmed = store.settle(token, 'confirmed', readTurnContext(), sessionCoordinator.current(), result);
            return confirmed ? result : null;
        }
        catch (error) {
            store.settle(token, asRequestNotDispatchedError(error) ? 'not-sent' : 'unknown', readTurnContext(), sessionCoordinator.current(), undefined, error instanceof SettingsRequestError ? error.status : undefined);
            return null;
        }
    };
    return { drafts, store, rows: rows.filter(r => r.kind === kind), row, id, ready, api, state, controller, navigation, context,
        refresh, capture, valid, run,
        select: (selected: string) => { if (store.select(selected))
            setId(selected); },
        fresh: () => { if (id && context?.ready && state?.ready) {
            const next = store.fresh(id, context);
            if (next)
                setId(next);
        } },
        locked: !id || !ready || store.locked(id) };
}
export type ConfigurationController = ReturnType<typeof useConfiguration>;
