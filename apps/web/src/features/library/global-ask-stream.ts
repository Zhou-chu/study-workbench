import { isRecord } from '@study/contracts';
export type AskEvent = {
    type: 'strategy';
    reasoning: string;
    searches: {
        term: string;
        instructions: string;
    }[];
} | {
    type: 'answer' | 'final_answer';
    content: string;
} | {
    type: 'complete';
    final_answer: string | null;
} | {
    type: 'error';
    message: string;
};
export function askEvent(v: unknown): AskEvent {
    if (!isRecord(v))
        throw new Error('Invalid Ask event');
    if (v.type === 'strategy' && typeof v.reasoning === 'string' && Array.isArray(v.searches) && v.searches.every(s => isRecord(s) && typeof s.term === 'string' && typeof s.instructions === 'string'))
        return { type: v.type, reasoning: v.reasoning, searches: v.searches as {
                term: string;
                instructions: string;
            }[] };
    if ((v.type === 'answer' || v.type === 'final_answer') && typeof v.content === 'string')
        return { type: v.type, content: v.content };
    if (v.type === 'complete' && (v.final_answer === null || typeof v.final_answer === 'string'))
        return { type: v.type, final_answer: v.final_answer };
    if (v.type === 'error' && typeof v.message === 'string')
        return { type: v.type, message: v.message };
    throw new Error('Invalid Ask event');
}
function configuredIdleMs() {
    const raw = import.meta.env.VITE_API_TIMEOUT_MS;
    const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    return Number.isFinite(value) && value >= 0 ? value : 600000;
}
/** Byte-idle observation watchdog. No server cancellation, replay cursor or retry. */
export async function readAskStream(response: Response, signal: AbortSignal, accept: (event: AskEvent) => void, idleMs = configuredIdleMs()) {
    if (!response.body || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'text/event-stream') {
        void response.body?.cancel();
        throw new Error('Invalid Ask stream');
    }
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '', terminal = false, expired = false, timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => { void reader.cancel().catch(() => { }); };
    const arm = () => { clearTimeout(timer); if (idleMs > 0)
        timer = setTimeout(() => { expired = true; cancel(); }, idleMs); };
    signal.addEventListener('abort', cancel);
    arm();
    try {
        while (!terminal) {
            if (signal.aborted || expired)
                throw new Error('Observation stopped');
            const { done, value } = await reader.read();
            if (signal.aborted || expired)
                throw new Error('Observation stopped');
            if (value?.byteLength)
                arm();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            if (buffer.length > 8 * 1024 * 1024)
                throw new Error('Ask frame too large');
            let boundary: RegExpExecArray | null;
            while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
                const frame = buffer.slice(0, boundary.index);
                buffer = buffer.slice(boundary.index + boundary[0].length);
                const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
                if (!data)
                    continue;
                const event = askEvent(JSON.parse(data));
                accept(event);
                if (event.type === 'complete' || event.type === 'error') {
                    terminal = true;
                    break;
                }
            }
            if (done && !terminal)
                throw new Error('Incomplete Ask stream');
        }
    }
    finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        await reader.cancel().catch(() => { });
        reader.releaseLock();
    }
}
