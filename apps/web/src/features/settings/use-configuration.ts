import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { canDispatch, readTurnContext, sessionCoordinator, subscribeTurnContext } from '@study/web-transport';
import { useAppData, useAppDrafts } from '../../app/providers';
import { useResourceNavigation, useWorkbenchSnapshot } from '../../app/WorkbenchSession';
import { createSettingsApi } from '../../data/settings-api';
import type { CredentialWrite, SourceName } from '../../data/configuration-contracts';
import { runConfigurationWrite } from './configuration-write';
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
    const run = (token: ConfigurationToken, takePrivateBody?: () => CredentialWrite | null) =>
        runConfigurationWrite(token, api, store, {
            ready: () => controller?.getSnapshot().ready === true,
            context: readTurnContext,
            generation: () => sessionCoordinator.current(),
            providerRevision: () => controller!.getSnapshot().providerEvidenceRevision,
        }, takePrivateBody);
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
