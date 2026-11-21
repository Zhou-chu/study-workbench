import { isRecord } from '@study/contracts';
import { indicators, type Indicators } from '../../data/native-chat';
export type SourceEvent = {
    type: 'ai_message' | 'user_message';
    content: string;
} | {
    type: 'context_indicators';
    data: Indicators;
} | {
    type: 'complete';
};
/** Whole-answer events, not token deltas. Canceling this reader only stops observation. */
export async function readSourceStream(response: Response, signal: AbortSignal, accept: (event: SourceEvent) => void) {
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        void response.body?.cancel();
        throw new Error('Invalid source stream');
    }
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '', complete = false;
    const abort = () => { void reader.cancel().catch(() => { }); };
    signal.addEventListener('abort', abort);
    try {
        while (!complete) {
            if (signal.aborted)
                throw new Error('Observation stopped');
            const { done, value } = await reader.read();
            if (signal.aborted)
                throw new Error('Observation stopped');
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            if (buffer.length > 8 * 1024 * 1024)
                throw new Error('Invalid source stream');
            let match: RegExpExecArray | null;
            while ((match = /\r?\n\r?\n/.exec(buffer))) {
                const frame = buffer.slice(0, match.index);
                buffer = buffer.slice(match.index + match[0].length);
                const data = frame.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
                if (!data)
                    continue;
                const event: unknown = JSON.parse(data);
                if (!isRecord(event))
                    throw new Error('Invalid event');
                if (event.type === 'error')
                    throw new Error('Source stream failed');
                if (event.type === 'complete') {
                    complete = true;
                    accept({ type: 'complete' });
                    break;
                }
                if (event.type === 'ai_message' || event.type === 'user_message') {
                    if (typeof event.content !== 'string' || event.timestamp != null && typeof event.timestamp !== 'string')
                        throw new Error('Invalid event');
                    accept({ type: event.type, content: event.content });
                }
                else if (event.type === 'context_indicators')
                    accept({ type: 'context_indicators', data: indicators(event.data) });
                else
                    throw new Error('Unsupported event');
            }
            if (done) {
                if (!complete)
                    throw new Error('Incomplete source stream');
                break;
            }
        }
    }
    finally {
        signal.removeEventListener('abort', abort);
        await reader.cancel().catch(() => { });
        reader.releaseLock();
    }
}
