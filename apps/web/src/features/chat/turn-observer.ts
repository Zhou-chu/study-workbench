import { isRecord, type OperationReceipt, type ObservedTurnState } from '@study/contracts';
import { observedTurnState } from '@study/domain';
import type { DispatchContext } from '@study/web-transport';
import type { TurnApi } from '../../data/turn-api';
const active = (state: ObservedTurnState) => ['queued', 'running', 'waiting_remote'].includes(state);
/** Called only for an explicitly admitted, known operation. Never installed by a query or unknown recovery. */
export function observeTurn(api: TurnApi, receipt: OperationReceipt, context: DispatchContext, onState: (state: ObservedTurnState) => void, valid: () => boolean): () => void {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const current = () => !abort.signal.aborted && valid();
    const stop = () => { abort.abort(); clearTimeout(timer); void reader?.cancel().catch(() => { }); };
    const emit = (state: ObservedTurnState) => {
        if (current())
            onState(state);
        return !active(state);
    };
    async function poll() {
        if (!current())
            return;
        try {
            const job = await api.job(receipt.job_id, context, abort.signal);
            if (!current())
                return;
            if (job.projection_status || job.job_id !== receipt.job_id || job.turn_id !== receipt.turn_id || job.operation !== 'chat' || job.restored_history === true || job.replay_allowed === false) {
                emit('unknown');
                return;
            }
            if (!emit(observedTurnState(job.state)))
                timer = setTimeout(() => { void poll(); }, 2000);
        }
        catch {
            if (current())
                emit('unknown');
        }
    }
    async function stream() {
        if (!current() || !receipt.turn_id)
            return;
        try {
            const response = await api.events(receipt.turn_id, context, abort.signal);
            if (!current()) {
                void response.body?.cancel();
                return;
            }
            if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream') || !response.body)
                throw new Error('Stream unavailable');
            reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (current()) {
                const chunk = await reader.read();
                if (!current())
                    return;
                if (chunk.done)
                    break;
                buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, '\n');
                if (buffer.length > 262144) {
                    emit('unknown');
                    return;
                }
                let end: number;
                while ((end = buffer.indexOf('\n\n')) >= 0) {
                    const frame = buffer.slice(0, end);
                    buffer = buffer.slice(end + 2);
                    const lines = frame.split('\n'), event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
                    if (!event || !['stage', 'final', 'error'].includes(event))
                        continue;
                    if (event === 'error') {
                        emit('unknown');
                        return;
                    }
                    let data: unknown;
                    try {
                        data = JSON.parse(lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'));
                    }
                    catch {
                        emit('unknown');
                        return;
                    }
                    if (!isRecord(data) || data.turn_id !== receipt.turn_id) {
                        emit('unknown');
                        return;
                    }
                    // SSE contains stages, not completion proof and not token text.
                    if (emit(observedTurnState(data.state ?? data.status)))
                        return;
                }
            }
        }
        catch { /* A broken stream may reread only this already authorized parent. */ }
        finally {
            void reader?.cancel().catch(() => { });
        }
        if (current())
            void poll();
    }
    void stream();
    return stop;
}
