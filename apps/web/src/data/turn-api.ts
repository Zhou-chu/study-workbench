import { isRecord, parseJobView, parseTurnView, readTurnPostOutcome, type TurnRequest, type TurnReceipt } from '@study/contracts';
import { canDispatch, freezeDispatchContext, readTurnContext, sessionCoordinator, checkTurnRecovery, RequestNotDispatchedError, TransportResponseError, asRequestNotDispatchedError, type DispatchContext, type WebTransport } from '@study/web-transport';
import type { SafePostOutcome, TurnCapture } from '@study/domain';
/** Existing Notebook namespace, not a newly created chat session or proof of model memory. */
export const notebookChatSessionId = (notebookId: string) => `v1_${notebookId}`;
export function createTurnApi(transport: WebTransport) {
    async function request(method: string, path: string, context: DispatchContext, signal?: AbortSignal, body?: string) {
        const captured = freezeDispatchContext(context), generation = sessionCoordinator.current();
        if (!canDispatch(captured, readTurnContext()))
            throw new RequestNotDispatchedError('superseded');
        const response = await transport.send({ method, path, context: captured, ...(body === undefined ? {} : { body }), ...(signal ? { signal } : {}) });
        const current = () => !signal?.aborted && canDispatch(captured, readTurnContext()) && generation === sessionCoordinator.current();
        if (!current()) {
            void response.body?.cancel();
            throw new TransportResponseError('retired');
        }
        return { response, current };
    }
    async function read(path: string, context: DispatchContext, signal?: AbortSignal, method = 'GET') {
        const { response, current } = await request(method, path, context, signal);
        const data: unknown = await response.json();
        if (!current())
            throw new TransportResponseError('retired');
        if (!response.ok)
            throw new Error('Turn read was not confirmed');
        return data;
    }
    const chat = (s: string) => `/personal/chats/${encodeURIComponent(s)}/turns`;
    return Object.freeze({
        /** Safe turn outcome, not the minimal generic OperationReceipt (F1). */
        async submit(sessionId: string, dto: TurnRequest, context: DispatchContext): Promise<SafePostOutcome> {
            try {
                const { response, current } = await request('POST', chat(sessionId), context, undefined, JSON.stringify(dto));
                const data: unknown = await response.json();
                if (!current())
                    return { kind: 'unknown', reason: 'transport' };
                return readTurnPostOutcome(response.status, data);
            }
            catch (error) {
                return asRequestNotDispatchedError(error) ? { kind: 'not-dispatched' } : { kind: 'unknown', reason: 'transport' };
            }
        },
        async list(sessionId: string, context: DispatchContext, signal?: AbortSignal) {
            const data = await read(chat(sessionId), context, signal);
            if (!Array.isArray(data))
                throw new Error('Invalid canonical history');
            return data.map(value => parseTurnView(value));
        },
        async events(turnId: string, context: DispatchContext, signal?: AbortSignal) {
            const { response } = await request('GET', `/personal/turns/${encodeURIComponent(turnId)}/events`, context, signal);
            return response;
        },
        async job(jobId: string, context: DispatchContext, signal?: AbortSignal) { return parseJobView(await read(`/personal/jobs/${encodeURIComponent(jobId)}`, context, signal), 'legacy'); },
        async cancel(jobId: string, context: DispatchContext) { return parseJobView(await read(`/personal/jobs/${encodeURIComponent(jobId)}/cancel`, context, undefined, 'POST'), 'legacy'); },
        async check(capture: TurnCapture, receipt?: TurnReceipt, signal?: AbortSignal, valid: () => boolean = () => true) {
            const generation = sessionCoordinator.current();
            const current = () => valid() && generation === sessionCoordinator.current() && canDispatch(capture.context, readTurnContext()) && !signal?.aborted;
            const guarded: WebTransport = { async send(spec) {
                    if (!current())
                        throw new RequestNotDispatchedError('superseded');
                    const response = await transport.send(spec);
                    if (!current()) {
                        void response.body?.cancel();
                        throw new TransportResponseError('retired');
                    }
                    return response;
                } };
            const match = await checkTurnRecovery(guarded, capture, receipt, signal);
            return current() ? match : { kind: 'unknown' as const, reason: 'unconfirmed' as const };
        },
        async modelAvailable(context: DispatchContext, signal?: AbortSignal) {
            const data = await read('/models/defaults', context, signal);
            if (!isRecord(data) || !Object.hasOwn(data, 'default_chat_model') || !(data.default_chat_model === null || typeof data.default_chat_model === 'string'))
                throw new Error('Invalid model defaults');
            return typeof data.default_chat_model === 'string' && !!data.default_chat_model.trim();
        },
        async capabilities(context: DispatchContext) {
            const data = await read('/personal/notebooklm/capabilities', context);
            if (!isRecord(data) || !Array.isArray(data.operations) || data.operations.some(row => !isRecord(row) || typeof row.name !== 'string' || typeof row.support !== 'string'))
                throw new Error('Invalid provider capabilities');
            return data.operations.map(row => ({ name: String(row.name), support: String(row.support) }));
        },
    });
}
export type TurnApi = ReturnType<typeof createTurnApi>;
