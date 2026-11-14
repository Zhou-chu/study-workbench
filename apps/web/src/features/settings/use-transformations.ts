import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { asRequestNotDispatchedError, canDispatch, readTurnContext, sessionCoordinator, subscribeTurnContext } from '@study/web-transport';
import { useAppData, useAppDrafts } from '../../app/providers';
import { useWorkbenchSnapshot, useResourceNavigation } from '../../app/WorkbenchSession';
import { createSettingsApi, SettingsRequestError } from '../../data/settings-api';
import type { Transformation, TransformationOutput } from '../../data/transformation-contracts';
import type { ModelsOwner } from './configuration-store';
import type { TransformationIntent, TransformationToken, ModelsCapture } from './transformation-store';
export function useTransformations() {
    const drafts = useAppDrafts(), store = drafts.transformations, queries = useQueryClient();
    const rows = useSyncExternalStore(drafts.subscribe, store.getSnapshot);
    useSyncExternalStore(drafts.subscribe, drafts.configuration.getSnapshot);
    const context = useSyncExternalStore(subscribeTurnContext, readTurnContext, () => null);
    const { state, controller } = useWorkbenchSnapshot(), navigation = useResourceNavigation(), { transport } = useAppData();
    const api = useMemo(() => transport ? createSettingsApi(transport) : null, [transport]);
    const [owner, setOwner] = useState<ModelsOwner | null>(null);
    const id = store.selected(), row = rows.find(r => r.id === id);
    useEffect(() => { if (!id && context?.ready && state?.ready)
        store.open(context); }, [id, context, state?.ready, store]);
    useEffect(() => { if (!id)
        return; navigation?.activateResource(id); return navigation?.holdResource(id); }, [id, navigation]);
    const ready = !!row && !row.retired && !!api && state?.ready === true && canDispatch(row.context, context);
    useEffect(() => {
        if (ready && context)
            setOwner(drafts.configuration.acquireModels(context));
    }, [ready, context?.epoch, context?.target, row?.id, drafts.configuration]);
    const modelRow = owner?.read(), modelsReady = !!owner && !!modelRow && !modelRow.retired && canDispatch(owner.context, context) && modelRow.sources.models?.phase === 'ready';
    const refreshModels = useCallback(async () => {
        if (!owner || !api || !controller?.getSnapshot().ready)
            return;
        const revision = owner.loading(readTurnContext()), g = sessionCoordinator.current();
        if (revision === null)
            return;
        try {
            const value = await api.models(owner.context);
            if (g === sessionCoordinator.current())
                owner.publish(revision, value, readTurnContext());
        }
        catch {
            if (g === sessionCoordinator.current())
                owner.publish(revision, null, readTurnContext());
        }
    }, [owner, api, controller]);
    useEffect(() => { if (owner && !owner.read()?.sources.models)
        void refreshModels(); }, [owner, refreshModels]);
    const refresh = useCallback(async () => {
        if (!id || !api || !controller?.getSnapshot().ready)
            return;
        const r = store.get(id), c = readTurnContext(), g = sessionCoordinator.current();
        if (!r || r.retired || !canDispatch(r.context, c))
            return;
        const list = store.loading(id, 'list'), instructions = store.loading(id, 'instructions');
        await Promise.all([
            (async () => { if (!list)
                return; try {
                const v = await api.transformations(r.context);
                if (g === sessionCoordinator.current() && canDispatch(r.context, readTurnContext()))
                    store.publishList(id, list.revision, v);
            }
            catch {
                store.publishList(id, list.revision, null);
            } })(),
            (async () => { if (!instructions)
                return; try {
                const v = await api.transformationInstructions(r.context);
                if (g === sessionCoordinator.current() && canDispatch(r.context, readTurnContext()))
                    store.publishInstructions(id, instructions, v);
            }
            catch {
                store.publishInstructions(id, instructions, null);
            } })()
        ]);
    }, [id, api, controller, store]);
    useEffect(() => { if (ready && id && !store.get(id)?.listRead)
        void refresh(); }, [ready, id, refresh, store]);
    const modelCapture = (modelId: string): ModelsCapture | null => {
        const r = owner?.read();
        if (!owner || !r || r.retired || !canDispatch(owner.context, readTurnContext()) || r.sources.models?.phase !== 'ready')
            return null;
        const model = r.data.models?.find(m => m.id === modelId && m.type === 'language');
        return model ? Object.freeze({ ownerId: owner.id, metadataRevision: r.metadataRevision, sourceRevision: r.sources.models.revision, model }) : null;
    };
    const capture = (intent: TransformationIntent) => {
        if (!id || !ready || !controller?.getSnapshot().ready)
            return null;
        const modelId = intent.kind === 'execute' ? intent.input.model_id : intent.kind === 'create' || intent.kind === 'update' ? store.get(id)?.editor?.fields.model_id ?? null : null;
        const models = modelId ? modelCapture(modelId) : null;
        if (modelId && !models)
            return null;
        return store.capture(id, intent, readTurnContext(), sessionCoordinator.current(), controller.getSnapshot().providerEvidenceRevision, models);
    };
    const valid = (token: TransformationToken) => !!api && controller?.getSnapshot().ready === true && store.canBegin(token, readTurnContext(), sessionCoordinator.current(), controller.getSnapshot().providerEvidenceRevision, token.models ? modelCapture(token.models.model.id) : null);
    const edit = async (target: string | null) => {
        if (!id || !ready || !api || !store.editor(id, target))
            return;
        const editor = store.get(id)!.editor!;
        if (target === null)
            return;
        const c = store.get(id)!.context, g = sessionCoordinator.current();
        try {
            const result = await api.transformation(target, c);
            if (g === sessionCoordinator.current() && canDispatch(c, readTurnContext()))
                store.detail(id, editor.id, result);
        }
        catch {
            store.detail(id, editor.id, null);
        }
    };
    const run = async (token: TransformationToken) => {
        if (!api || !controller?.getSnapshot().ready || !store.begin(token, readTurnContext(), sessionCoordinator.current(), controller.getSnapshot().providerEvidenceRevision, token.models ? modelCapture(token.models.model.id) : null))
            return false;
        const i = token.intent, c = token.context, k = token.id;
        try {
            let result: Transformation | TransformationOutput | string | undefined;
            if (i.kind === 'instructions')
                result = await api.saveTransformationInstructions(i.value, c, k);
            else if (i.kind === 'create')
                result = await api.createTransformation(i.input, c, k);
            else if (i.kind === 'update')
                result = await api.updateTransformation(i.target, i.input, c, k);
            else if (i.kind === 'delete')
                await api.deleteTransformation(i.target, c, k);
            else
                result = await api.executeTransformation(i.input, c, k);
            const confirmed = store.settle(token, 'confirmed', readTurnContext(), sessionCoordinator.current(), result);
            if (confirmed && ['create', 'update', 'delete'].includes(i.kind)) {
                void queries.invalidateQueries({ queryKey: ['library', 'transformations', JSON.stringify([c.epoch, c.target, token.generation])], exact: true });
                const r = store.get(token.ownerId);
                if (r && !r.retired && store.selected() === token.ownerId && canDispatch(c, readTurnContext())) {
                    const read = store.loading(r.id, 'list');
                    if (read)
                        try {
                            store.publishList(r.id, read.revision, await api.transformations(c));
                        }
                        catch {
                            store.publishList(r.id, read.revision, null);
                        }
                }
            }
            return confirmed;
        }
        catch (error) {
            store.settle(token, asRequestNotDispatchedError(error) ? 'not-sent' : 'unknown', readTurnContext(), sessionCoordinator.current(), undefined, error instanceof SettingsRequestError ? error.status : undefined);
            return false;
        }
    };
    return { store, row, rows, id, context, ready, models: modelRow?.data.models ?? [], modelsReady, modelState: modelRow?.sources.models, refresh, refreshModels, capture, valid, edit, run,
        fresh: () => { if (id && context && state?.ready)
            store.fresh(id, context); } };
}
