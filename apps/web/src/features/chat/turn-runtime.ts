import { createTurnRegistry, createOperation, reduceOperation, type ValidatedTurnCapture, type AttemptToken, type TurnOperation, type OperationModel, type AdmissionResult, type TurnCapture } from '@study/domain';
import type { ObservedTurnState, TurnView } from '@study/contracts';
import { canDispatch, readTurnContext, sessionCoordinator } from '@study/web-transport';
import type { TurnApi } from '../../data/turn-api';
import { observeTurn } from './turn-observer';
type Entry = {
    readFence: () => (() => boolean);
    api: TurnApi;
    valid: () => boolean;
    accepted: () => void;
    operation: OperationModel;
    stop?: (() => void) | undefined;
    stage: ObservedTurnState;
    retired: boolean;
    waiting: boolean;
    authorized: boolean;
};
export type ConversationSnapshot = Readonly<{
    operation: TurnOperation | null;
    stage: ObservedTurnState;
    waiting: boolean;
    retired: boolean;
    turns: readonly TurnView[];
    outlines: readonly Readonly<{
        turn: TurnView;
        capture: TurnCapture;
    }>[];
}>;
const empty: ConversationSnapshot = Object.freeze({ operation: null, stage: 'unknown', waiting: false, retired: false, turns: [], outlines: [] });
/** Application-owned, bounded A4 capture registry. Route unmount only removes subscribers. */
export function createTurnRuntime(notifyDrafts: () => void = () => { }) {
    const registry = createTurnRegistry(() => crypto.randomUUID()), entries = new Map<string, Entry>(), snapshots = new Map<string, ConversationSnapshot>(), listeners = new Set<() => void>();
    const publish = (n: string) => { const entry = entries.get(n), old = snapshots.get(n) ?? empty; snapshots.set(n, Object.freeze({ ...old, operation: registry.getSnapshot(n), stage: entry?.stage ?? 'unknown', waiting: entry?.waiting ?? false, retired: entry?.retired ?? false })); listeners.forEach(fn => fn()); notifyDrafts(); };
    registry.subscribe(() => {
        for (const n of entries.keys())
            publish(n);
    });
    const current = (n: string, entry: Entry) => entries.get(n) === entry && !entry.retired && entry.valid();
    const stop = (n: string) => {
        const e = entries.get(n);
        if (!e)
            return;
        e.stop?.();
        e.stop = undefined;
        e.waiting = false;
        e.operation = reduceOperation(e.operation, { type: 'stop-waiting' });
        publish(n);
    };
    async function check(n: string) {
        const e = entries.get(n), op = registry.getSnapshot(n);
        if (!e || !op || e.retired)
            return;
        const fence = e.readFence();
        if (!fence())
            return;
        const token = registry.beginCheck(op.capture.operationId);
        if (!token)
            return;
        const checking = registry.getSnapshot(n);
        const valid = () => entries.get(n) === e && !e.retired && fence();
        const result = await e.api.check(op.capture, op.receipt, undefined, valid).catch(() => ({ kind: 'unknown' as const, reason: 'unconfirmed' as const }));
        if (registry.getSnapshot(n) !== checking)
            return;
        registry.settleCheck(token, valid() ? result : { kind: 'unknown', reason: 'unconfirmed' });
        if (!valid()) {
            e.stage = 'unknown';
            publish(n);
            return;
        }
        e.stage = result.kind === 'complete' ? 'succeeded' : result.kind === 'bound' ? result.state : 'unknown';
        if (result.kind === 'complete') {
            stop(n);
            const prior = snapshots.get(n) ?? empty;
            snapshots.set(n, Object.freeze({ ...prior, turns: [...prior.turns.filter(t => t.turn_id !== result.turn.turn_id), result.turn], outlines: op.capture.dto.task === 'outline' ? [...prior.outlines.filter(t => t.turn.turn_id !== result.turn.turn_id), { turn: result.turn, capture: op.capture }] : prior.outlines }));
            registry.releaseCompleted(op.capture.operationId);
        }
        publish(n);
    }
    function observe(n: string, e: Entry) {
        const op = registry.getSnapshot(n);
        if (!op?.receipt || !e.authorized || e.waiting || !current(n, e) || !['queued', 'running', 'waiting_remote'].includes(e.stage))
            return;
        e.waiting = true;
        publish(n);
        e.stop = observeTurn(e.api, { job_id: op.receipt.jobId, turn_id: op.receipt.turnId }, op.capture.context, stage => {
            if (!current(n, e))
                return;
            e.stage = stage;
            const token = e.operation.token;
            if (token && stage === 'running')
                e.operation = reduceOperation(e.operation, { type: 'running', token });
            if (!['queued', 'running', 'waiting_remote'].includes(stage)) {
                e.waiting = false;
                if (stage === 'succeeded')
                    void check(n);
            }
            publish(n);
        }, () => current(n, e));
    }
    async function post(n: string, token: AttemptToken, e: Entry) {
        const op = registry.getSnapshot(n);
        if (!op || op.token !== token)
            return;
        const outcome = current(n, e) ? await e.api.submit(op.capture.sessionId, op.capture.dto, op.capture.context) : { kind: 'not-dispatched' as const };
        if (registry.getSnapshot(n)?.token !== token)
            return;
        const valid = current(n, e);
        const result = valid ? outcome : { kind: 'unknown' as const, reason: 'transport' as const };
        registry.settlePost(token, result.kind === 'bound' && result.dispatchUnknown ? { ...result, state: 'unknown' } : result);
        const original = e.operation.token;
        if (original)
            e.operation = reduceOperation(e.operation, result.kind === 'bound' ? { type: 'accepted', token: original, receipt: { job_id: result.jobId, turn_id: result.turnId } } : { type: result.kind === 'not-dispatched' ? 'not-sent' : 'unknown', token: original });
        e.authorized = valid && result.kind === 'bound' && !result.dispatchUnknown && ['queued', 'running', 'waiting_remote', 'succeeded'].includes(result.state);
        e.stage = result.kind === 'bound' && !result.dispatchUnknown ? result.state : 'unknown';
        if (e.authorized) {
            e.accepted();
            if (e.stage === 'succeeded')
                void check(n);
            else
                observe(n, e);
        }
        publish(n);
    }
    const canRetry = (n: string, available: () => boolean) => { const op = registry.getSnapshot(n), e = entries.get(n); return !!e && !!op && op.phase === 'not-sent' && !op.everPossiblyDispatched && current(n, e) && available(); };
    return {
        registry,
        canRetry,
        getSnapshot: (n: string) => snapshots.get(n) ?? empty,
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        start(capture: ValidatedTurnCapture, api: TurnApi, valid: () => boolean, accepted: () => void, readFence: () => (() => boolean) = () => valid): AdmissionResult {
            if (!valid() || !canDispatch(capture.context, readTurnContext()))
                return { ok: false, reason: 'unavailable' };
            const result = registry.admit(capture);
            if (!result.ok)
                return result;
            const n = capture.request.notebook_id, generation = sessionCoordinator.current();
            const model = reduceOperation(createOperation(capture.context, result.token.operationId, { serverIdempotency: true, sessionGeneration: generation }), { type: 'begin', context: capture.context, sessionGeneration: generation });
            const e: Entry = { api, readFence, valid: () => valid() && generation === sessionCoordinator.current(), accepted, operation: model, stage: 'unknown', retired: false, waiting: false, authorized: false };
            entries.set(n, e);
            publish(n);
            void post(n, result.token, e);
            return result;
        },
        check,
        retry(n: string, available: () => boolean) {
            const op = registry.getSnapshot(n), e = entries.get(n);
            if (!e || !op || !canRetry(n, available))
                return;
            const token = registry.beginRetry(op.capture.operationId);
            if (token) {
                e.operation = reduceOperation(e.operation, { type: 'begin', context: op.capture.context, sessionGeneration: sessionCoordinator.current() });
                void post(n, token, e);
            }
        },
        abandon(n: string) {
            const op = registry.getSnapshot(n);
            if (op && registry.abandonNotSent(op.capture.operationId)) {
                stop(n);
                entries.delete(n);
                publish(n);
            }
        },
        stop,
        retire(epoch: number) {
            for (const [n, e] of entries) {
                if (e.operation.context.epoch === epoch) {
                    stop(n);
                    e.retired = true;
                    const old = snapshots.get(n) ?? empty;
                    snapshots.set(n, { ...old, turns: [], outlines: [] });
                    publish(n);
                }
            }
        },
        refreshFences() {
            for (const [n, e] of entries)
                if (e.waiting && !current(n, e)) {
                    stop(n);
                    e.stage = 'unknown';
                    publish(n);
                }
        },
        consumeOutline(n: string, turnId: string) {
            const old = snapshots.get(n);
            if (old) {
                snapshots.set(n, { ...old, outlines: old.outlines.filter(t => t.turn.turn_id !== turnId) });
                publish(n);
            }
        },
        hasPending(n?: string) { return [...entries.keys()].some(id => (!n || n === id) && !!registry.getSnapshot(id)); },
    };
}
