import { asRequestNotDispatchedError, canDispatch, readTurnContext, sessionCoordinator } from '@study/web-transport';
import { LibraryError, type LibraryApi, type LibrarySource } from '../../data/library-api';
import type { LibraryStore, LibraryDraft, ItemReceipt, LibraryStatus, ImportInput } from './library-store';
export function failure(error: unknown): 'not-sent' | 'rejected' | 'unknown' { return asRequestNotDispatchedError(error) ? 'not-sent' : error instanceof LibraryError && ['rejected', 'missing'].includes(error.kind) ? 'rejected' : 'unknown'; }
export function sourceHref(id: string) { return '/sources/' + encodeURIComponent(id); }
export function safeContentUrl(value: string | null | undefined) {
    try {
        const u = new URL(value ?? '');
        return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;
    }
    catch {
        return null;
    }
}
export function youtubeId(value: string | null | undefined) {
    const safe = safeContentUrl(value);
    if (!safe)
        return null;
    const u = new URL(safe);
    const host = u.hostname.toLowerCase();
    let id: string | null = null;
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host))
        id = u.pathname === '/watch' ? u.searchParams.get('v') : /^\/(?:embed|shorts)\/([^/]+)$/.exec(u.pathname)?.[1] ?? null;
    else if (host === 'youtu.be')
        id = u.pathname.slice(1);
    return id && /^[\w-]{11}$/.test(id) ? id : null;
}
export function retryReason(s: LibrarySource): 'completed' | 'active' | 'unknown' | null {
    if (s.submissionUnknown)
        return 'unknown';
    if (s.status === 'completed')
        return 'completed';
    if (['running', 'queued', 'new', 'pending'].includes(s.status ?? ''))
        return 'active';
    if (s.command_id && !['failed', 'canceled', 'cancelled'].includes(s.status ?? ''))
        return 'unknown';
    if (s.status !== null && !['failed', 'canceled', 'cancelled'].includes(s.status))
        return 'unknown';
    return null;
}
export function validImportInput(input: ImportInput, finalStep = true): boolean {
    if (finalStep && input.step !== 3 || input.notebooks.length > 50 || input.transformations.length > 50)
        return false;
    if ([...input.notebooks, ...input.transformations].some(id => !id.trim()))
        return false;
    if (input.type === 'text')
        return !!input.text.trim();
    if (input.type === 'upload')
        return input.files.length > 0 && input.files.every(file => file instanceof File);
    const urls = input.urls.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    return input.type === 'link' && urls.length > 0 && urls.every(url => !!safeContentUrl(url));
}
export async function executeLibraryDraft(store: LibraryStore, id: string, api: LibraryApi) {
    const input = store.get(id)?.input;
    if (input?.kind === 'import' && !validImportInput(input))
        return;
    const row = store.begin(id, readTurnContext(), sessionCoordinator.current());
    if (!row?.token)
        return;
    const token = row.token, p = row.input, c = row.context, g = row.generation;
    const finish = (status: LibraryStatus, command?: string) => store.finish(id, token, status, readTurnContext(), sessionCoordinator.current(), command);
    const current = () => store.current(row, readTurnContext(), sessionCoordinator.current()) && store.get(id)?.status === 'pending' && !store.get(id)?.stopRequested;
    const record = (index: number, result: ItemReceipt) => store.item(id, token, index, result, readTurnContext(), sessionCoordinator.current());
    const submitItem = async (index: number, call: () => Promise<ItemReceipt>) => {
        try {
            const result = await call();
            record(index, result);
            return result.state;
        }
        catch (error) {
            const state = failure(error);
            if (state === 'not-sent' && index === 0)
                return state;
            record(index, { state, ...(error instanceof LibraryError && error.resourceId ? { resourceId: error.resourceId } : {}), ...(error instanceof LibraryError && error.commandId ? { commandId: error.commandId } : {}) });
            return state;
        }
    };
    try {
        if (p.kind === 'import') {
            const items = p.type === 'link' ? p.urls.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : p.type === 'upload' ? [...p.files] : [p.text];
            let rejected = false;
            for (let i = 0; i < items.length; i++) {
                if (!current()) {
                    finish('unknown');
                    return;
                }
                const value = items[i]!;
                const state = await submitItem(i, async () => { const source = await api.sources.create({ type: p.type, ...(items.length === 1 && p.title ? { title: p.title } : {}), ...(p.type === 'link' ? { url: String(value) } : p.type === 'text' ? { content: String(value) } : { file: value as File }), notebooks: p.notebooks, transformations: p.transformations, embed: p.embed }, c, id + ':' + i); return { state: 'accepted', resourceId: source.id, ...(source.command_id ? { commandId: source.command_id } : {}) }; });
                if (state === 'unknown') {
                    finish('unknown');
                    return;
                }
                if (state === 'not-sent') {
                    finish(i === 0 ? 'not-sent' : 'unknown');
                    return;
                }
                rejected ||= state === 'rejected';
            }
            finish(rejected ? 'failed' : 'succeeded');
            return;
        }
        if (p.kind === 'associations' || p.kind === 'existing') {
            const changes = p.kind === 'associations' ? [...p.selected.filter(n => !p.original.includes(n)).map(n => ({ n, s: p.sourceId, linked: true })), ...p.original.filter(n => !p.selected.includes(n)).map(n => ({ n, s: p.sourceId, linked: false }))] : p.selected.map(s => ({ n: p.notebookId, s, linked: true }));
            let rejected = false;
            for (let i = 0; i < changes.length; i++) {
                if (!current()) {
                    finish('unknown');
                    return;
                }
                const item = changes[i]!;
                const outcome = await submitItem(i, async () => {
                    await api.sources.get(item.s, c); // A result label alone is not source authority.
                    if (!current())
                        throw new Error('Retired');
                    await api.associations.set(item.n, item.s, item.linked, c, id + ':' + i);
                    return { state: 'accepted', resourceId: item.s, targetId: item.n };
                });
                if (outcome === 'unknown') {
                    finish('unknown');
                    return;
                }
                if (outcome === 'not-sent') {
                    finish(i === 0 ? 'not-sent' : 'unknown');
                    return;
                }
                rejected ||= outcome === 'rejected';
            }
            finish(rejected ? 'failed' : 'succeeded');
            return;
        }
        if (p.kind === 'metadata') {
            await api.sources.update(p.sourceId, { title: p.title, topics: p.topics.split(',').map(s => s.trim()).filter(Boolean) }, c, id);
            finish('succeeded');
            return;
        }
        if (p.kind !== 'action')
            throw new LibraryError('invalid');
        if (p.action === 'delete')
            await api.sources.delete(p.sourceId, c, id);
        else if (p.action === 'unlink' && p.notebookId)
            await api.associations.set(p.notebookId, p.sourceId, false, c, id);
        else if (p.action === 'delete-insight' && p.insightId)
            await api.insights.delete(p.insightId, c, id);
        else if (p.action === 'retry') {
            const s = await api.sources.get(p.sourceId, c);
            if (!current() || retryReason(s))
                throw new LibraryError('rejected', 409);
            const s2 = await api.sources.retry(p.sourceId, c, id);
            record(0, { state: 'accepted', resourceId: s2.id, ...(s2.command_id ? { commandId: s2.command_id } : {}) });
            finish(s2.command_id ? 'accepted' : 'unknown', s2.command_id ?? undefined);
            return;
        }
        else if (p.action === 'embed' || p.action === 'insight') {
            const receipt = p.action === 'embed' ? await api.embed(p.sourceId, c, id) : await api.insights.create(p.sourceId, p.transformationId!, c, id);
            record(0, { state: 'accepted', resourceId: p.sourceId, ...(receipt.commandId ? { commandId: receipt.commandId } : {}) });
            finish(receipt.commandId ? 'accepted' : 'unknown', receipt.commandId ?? undefined);
            return;
        }
        else
            throw new LibraryError('invalid');
        finish('succeeded');
    }
    catch (error) {
        const outcome = failure(error);
        if (outcome === 'unknown' && p.kind === 'action' && ['retry', 'embed', 'insight'].includes(p.action)) {
            const receipt: ItemReceipt = { state: 'unknown', ...(error instanceof LibraryError && error.resourceId ? { resourceId: error.resourceId } : {}), ...(error instanceof LibraryError && error.commandId ? { commandId: error.commandId } : {}) };
            record(0, receipt);
            finish('unknown', receipt.commandId);
        }
        else
            finish(outcome);
    }
    // Captured ownership is never replaced by current identity after an await.
    void g;
}
export async function observeCommand(api: LibraryApi, row: LibraryDraft, store: LibraryStore, signal: AbortSignal, onTerminal: () => void) {
    if (!row.commandId || !row.token)
        return;
    let failures = 0;
    const valid = () => !signal.aborted && canDispatch(row.context, readTurnContext()) && row.generation === sessionCoordinator.current() && store.get(row.id)?.status === 'accepted' && !store.get(row.id)?.stopRequested;
    while (valid()) {
        try {
            const status = await api.command(row.commandId, row.context, signal);
            if (!valid())
                return;
            failures = 0;
            store.observe(row.id, row.token, status.status, readTurnContext(), sessionCoordinator.current());
            if (store.get(row.id)?.status !== 'accepted') {
                onTerminal();
                return;
            }
        }
        catch {
            if (!valid())
                return;
            if (++failures >= 3) {
                store.observe(row.id, row.token, 'unknown', readTurnContext(), sessionCoordinator.current());
                return;
            }
        }
        await new Promise<void>(resolve => { const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }; const timer = setTimeout(done, 2000); signal.addEventListener('abort', done, { once: true }); });
    }
}
