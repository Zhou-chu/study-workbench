import { parseProviderStatus, type ProviderStatus } from '../../data/provider-status';
import type { DispatchContext } from '@study/web-transport';
import type { ClientCapabilitiesV1, RuntimeConfig } from '@study/contracts';
import { classifyAuthFailure, createSessionClient, createWebTransport, invalidateTurnContext, publishTurnTarget, readTurnContext, sessionCoordinator, suspendTurnTarget, TransportResponseError, RequestNotDispatchedError, type AuthPhase, type SessionClient, type RequestSpec, type WebTransport } from '@study/web-transport';
import { ConfigurationError, errorCode, loadRuntimeConfig, loadClientCapabilities, parseSessionMetadata, parseWebStatus, type SessionMetadata } from '../../data/config';
export type ConnectionIssue = 'configuration' | 'capabilities' | 'ingress' | 'connection' | 'invalid-password' | null;
export type SessionSnapshot = Readonly<{
    reauthOpen: boolean;
    signedOutLocally: boolean;
    localSignoutConfirmed: boolean | null;
    serverRevocation: 'unconfirmed' | 'not-performed' | null;
    providerVerification: Readonly<{status: ProviderStatus | null; context: DispatchContext; generation: number; revision: number}> | null;
    phase: AuthPhase;
    ready: boolean;
    busy: boolean;
    hasWorkspace: boolean;
    privacyChanged: boolean;
    providerNeedsReauth: boolean;
    providerChecking: boolean;
    /** Monotonic invalidation/verification fence, never provider-account identity. */
    providerEvidenceRevision: number;
    issue: ConnectionIssue;
    capabilities: ClientCapabilitiesV1 | null;
}>;
/** One mounted application owns the coordinator. Metadata is not identity or authority. */
export function createSessionController(onRetire: (epoch: number) => void = () => { }) {
    let snapshot: SessionSnapshot = { reauthOpen: true, signedOutLocally:false, localSignoutConfirmed:null, serverRevocation:null, providerVerification:null, phase: 'bootstrapping', ready: false, busy: false, hasWorkspace: false, privacyChanged: false, providerNeedsReauth: false, providerChecking: false, providerEvidenceRevision: 0, issue: null, capabilities: null };
    let config: RuntimeConfig | null = null;
    let client: SessionClient | null = null;
    let raw: WebTransport | null = null;
    let metadata: SessionMetadata | null = null;
    let disposed = false;
    let ticket = 0;
    let flight: Promise<void> | null = null;
    let signedOut = false;
    let providerRevision = 0;
    let providerFlight: {
        ticket: number;
        revision: number;
        promise: Promise<boolean>;
    } | null = null;
    let loginRequired = false;
    let signoutFlight: Promise<void> | null = null;
    let signoutClient: SessionClient | null = null;
    let signoutMode: RuntimeConfig['auth_mode'] | null = null;
    const listeners = new Set<() => void>();
    const update = (patch: Partial<SessionSnapshot>) => {
        if (disposed)
            return;
        snapshot = Object.freeze({ ...snapshot, ...patch });
        listeners.forEach(fn => fn());
    };
    const phase = (next: AuthPhase) => {
        if (next === 'reauth-required' || next === 'anonymous' && snapshot.hasWorkspace && !signedOut)
            loginRequired = true;
        sessionCoordinator.setPhase(next);
        update({ phase: next, ...((next === 'reauth-required' || next === 'anonymous') && snapshot.phase !== next ? {reauthOpen:true} : {}) });
    };
    const suspend = () => { suspendTurnTarget(); update({ ready: false, capabilities: null }); };
    const retire = () => {
        const old = readTurnContext();
        suspend();
        invalidateTurnContext();
        update({providerEvidenceRevision:++providerRevision,providerVerification:null});
        if (old)
            onRetire(old.epoch);
        if (snapshot.hasWorkspace)
            update({ privacyChanged: true });
    };
    const storageChanged = (event: StorageEvent) => {
        if (config?.auth_mode === 'legacy_password' && (event.key === 'auth-storage' || event.key === null)) {
            ++ticket;
            sessionCoordinator.begin();
            flight = null;
            retire();
            phase('reauth-required');
            update({ busy: false, issue: null });
        }
    };
    let unsubscribe = () => { };
    let listening = false;
    const listen = () => {
        if (listening)
            return;
        listening = true;
        window.addEventListener('storage', storageChanged);
        unsubscribe = sessionCoordinator.subscribe(next => {
            if (disposed || signedOut)
                return;
            suspend();
            phase(next);
            update({ issue: next === 'unavailable' ? 'connection' : null });
        });
    };
    const authFailure = (status: number, code: string | null) => {
        const next = classifyAuthFailure(status, { error: { code } });
        if (!next)
            return false;
        suspend();
        phase(next);
        update({ issue: next === 'unavailable' ? 'connection' : null });
        return true;
    };
    const fail = (error: unknown, stage: 'configuration' | 'capabilities' | 'connection') => {
        if (error instanceof TransportResponseError && error.kind === 'retired')
            return;
        suspend();
        update({ issue: error instanceof TransportResponseError ? (error.kind === 'ingress-unavailable' ? 'ingress' : 'connection') : stage });
        if (stage !== 'capabilities')
            phase('unavailable');
    };
    async function accept(operation: number, own: number) {
        if (disposed || own !== ticket || !sessionCoordinator.isCurrent(operation))
            return;
        sessionCoordinator.confirmed();
        phase('authenticated');
        const current = readTurnContext();
        if (!current)
            throw new ConfigurationError();
        publishTurnTarget(current.target, true);
        try {
            const context = readTurnContext()!;
            const capabilities = await loadClientCapabilities(context);
            if (readTurnContext()?.epoch !== context.epoch)
                return;
            if (disposed || own !== ticket || !sessionCoordinator.isCurrent(operation))
                return;
            update({ ready: true, capabilities, hasWorkspace: true, issue: null });
        }
        catch (error) {
            if (own === ticket && !disposed) {
                if (snapshot.phase === 'authenticated')
                    fail(error, 'capabilities');
            }
        }
    }
    async function checkStatus(operation: number, own: number) {
        if (!client || !config)
            return;
        const response = await client.status(operation);
        if (disposed || own !== ticket)
            return;
        if (!response.ok) {
            const code = await errorCode(response);
            if (disposed || own !== ticket)
                return;
            if (authFailure(response.status, code))
                return;
            throw new ConfigurationError();
        }
        const data: unknown = await response.json();
        if (disposed || own !== ticket)
            return;
        if (config.auth_mode === 'device_sessions') {
            const result = parseWebStatus(data);
            if (metadata && result.session && metadata.session_id !== result.session.session_id)
                retire();
            metadata = result.session;
            phase(result.phase);
            if (result.phase === 'authenticated')
                await accept(operation, own);
            else
                suspend();
        }
        else {
            if (!data || typeof data !== 'object' || !('auth_enabled' in data) || typeof data.auth_enabled !== 'boolean')
                throw new ConfigurationError();
            if (data.auth_enabled) {
                const probe = await client.probeLegacy(operation);
                if (disposed || own !== ticket)
                    return;
                if (!probe.ok) {
                    const code = await errorCode(probe);
                    if (disposed || own !== ticket)
                        return;
                    if (probe.status === 401 && ['LEGACY_INVALID_PASSWORD', 'AUTH_REQUIRED', 'AUTH_INVALID_CREDENTIALS'].includes(code ?? '')) {
                        phase(snapshot.hasWorkspace ? 'reauth-required' : 'anonymous');
                        update({ issue: null });
                        suspend();
                        return;
                    }
                    if (authFailure(probe.status, code))
                        return;
                    throw new ConfigurationError();
                }
            }
            await accept(operation, own);
        }
    }
    async function run(kind: 'check' | 'login' | 'refresh', password?: string) {
        if (disposed || flight || signoutFlight)
            return flight ?? signoutFlight ?? Promise.resolve();
        if(signedOut && kind!=='login'){phase('anonymous');return;}
        listen();
        if (kind !== 'login' && loginRequired) {
            phase('reauth-required');
            return;
        }
        const own = ++ticket;
        const operation = sessionCoordinator.begin();
        update({ busy: true, providerChecking: false, issue: null });
        suspend();
        const task = (async () => {
            let stage: 'configuration' | 'capabilities' | 'connection' = 'configuration';
            try {
                const selected = await loadRuntimeConfig();
                if (disposed || own !== ticket)
                    return;
                if (config && (config.auth_mode !== selected.auth_mode || config.web_session_protocol !== selected.web_session_protocol))
                    retire();
                config = selected;
                raw = createWebTransport(config);
                client = createSessionClient(config);
                stage = 'connection';
                if (kind === 'login') {
                    const response = await client.login(password ?? '', undefined, operation);
                    if (disposed || own !== ticket)
                        return;
                    if (!response.ok) {
                        const code = await errorCode(response);
                        if (disposed || own !== ticket)
                            return;
                        if (['LEGACY_INVALID_PASSWORD', 'AUTH_INVALID_CREDENTIALS'].includes(code ?? '')) {
                            phase(snapshot.hasWorkspace ? 'reauth-required' : 'anonymous');
                            update({ issue: 'invalid-password' });
                            return;
                        }
                        if (authFailure(response.status, code))
                            return;
                        throw new ConfigurationError();
                    }
                    if (config.auth_mode === 'device_sessions') {
                        if (response.status !== 201)
                            throw new ConfigurationError();
                        const parsed = parseSessionMetadata(await response.json());
                        if (disposed || own !== ticket)
                            return;
                        metadata = parsed;
                    }
                    // A fresh successful login gives no proof of continuity with an old identity.
                    if (snapshot.hasWorkspace)
                        retire();
                    signedOut = false; signoutClient=null; signoutMode=null;
                    update({signedOutLocally:false,localSignoutConfirmed:null,serverRevocation:null,reauthOpen:true});
                    loginRequired = false;
                    if (config.auth_mode === 'legacy_password')
                        await accept(operation, own);
                    else
                        await checkStatus(operation, own);
                }
                else if (signedOut) {
                    phase('anonymous');
                }
                else if (kind === 'refresh' && config.auth_mode === 'device_sessions') {
                    const response = await client.refresh(operation);
                    if (disposed || own !== ticket)
                        return;
                    if (!response.ok) {
                        const code = await errorCode(response);
                        if (disposed || own !== ticket)
                            return;
                        if (authFailure(response.status, code))
                            return;
                        throw new ConfigurationError();
                    }
                    if (response.status !== 200)
                        throw new ConfigurationError();
                    const next = parseSessionMetadata(await response.json());
                    if (disposed || own !== ticket)
                        return;
                    if (metadata && next.session_id !== metadata.session_id)
                        retire();
                    metadata = next;
                    await checkStatus(operation, own);
                }
                else
                    await checkStatus(operation, own);
            }
            catch (error) {
                if (!disposed && own === ticket)
                    fail(error, stage);
            }
            finally {
                if (!disposed && own === ticket)
                    update({ busy: false });
            }
        })();
        flight = task;
        await task;
        if (flight === task)
            flight = null;
    }
    const transport: WebTransport = Object.freeze({ async send(request: RequestSpec) {
            if (!snapshot.ready || !raw)
                throw new RequestNotDispatchedError('configuration');
            const own = ticket;
            const authEvidence = sessionCoordinator.evidence();
            try {
                const response = await raw.send(request);
                if (disposed || own !== ticket)
                    throw new TransportResponseError('retired');
                if (!response.ok) {
                    const code = await errorCode(response);
                    if (disposed || own !== ticket)
                        throw new TransportResponseError('retired');
                    if (code === 'NEEDS_REAUTH' && authEvidence === sessionCoordinator.evidence() && snapshot.phase === 'authenticated' && snapshot.ready) {
                        providerRevision++;
                        update({ providerNeedsReauth: true, providerEvidenceRevision: providerRevision });
                    }
                    else if (response.status === 401 && ['LEGACY_INVALID_PASSWORD', 'AUTH_REQUIRED', 'REFRESH_REJECTED'].includes(code ?? '')) {
                        suspend();
                        phase('reauth-required');
                        update({ issue: null });
                    }
                }
                return response;
            }
            catch (error) {
                if (!disposed && own === ticket && !(error instanceof RequestNotDispatchedError))
                    fail(error, 'connection');
                throw error;
            }
        } });
    async function verifyProviderConnection(): Promise<boolean> {
        if (disposed || !snapshot.ready || snapshot.phase !== 'authenticated')
            return false;
        if (providerFlight?.ticket === ticket)
            return providerFlight.promise;
        const own = ticket;
        const context = readTurnContext();
        if (!context?.ready)
            return false;
        const evidence = sessionCoordinator.evidence(), generation = sessionCoordinator.current();
        const revision = ++providerRevision;
        update({ providerChecking: true, providerEvidenceRevision: revision });
        const task = (async () => {
            try {
                // Deliberate verification only: this existing GET may resume confirmed read-phase jobs.
                const response = await transport.send({ method: 'GET', path: '/personal/connections/notebooklm', context });
                if (!response.ok)
                    return false;
                const value: unknown = await response.json();
                if (disposed || own !== ticket || evidence !== sessionCoordinator.evidence() || revision !== providerRevision || readTurnContext()?.epoch !== context.epoch || !snapshot.ready || snapshot.phase !== 'authenticated')
                    return false;
                let status: ProviderStatus | null = null;
                try { status = parseProviderStatus(value); } catch { /* Keep malformed evidence visibly non-actionable. */ }
                const connected = status?.state === 'connected';
                const published = ++providerRevision;
                update({ ...(connected ? {providerNeedsReauth:false} : {}), providerEvidenceRevision:published, providerVerification:Object.freeze({status,context,generation,revision:published}) });
                return connected;
            }
            catch {
                return false;
            }
            finally {
                if (!disposed && own === ticket && providerFlight?.revision === revision)
                    update({ providerChecking: false });
            }
        })();
        const entry = { ticket: own, revision, promise: task };
        providerFlight = entry;
        try {
            return await task;
        }
        finally {
            if (providerFlight === entry)
                providerFlight = null;
        }
    }
    return { getSnapshot: () => snapshot, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }, transport,
        verifyProviderConnection,
        invalidateProviderAdmission() { providerFlight = null; update({ providerEvidenceRevision: ++providerRevision, providerVerification: null, providerChecking: false }); },
        start: () => run('check'), check: () => run('check'), login: (password: string) => run('login', password), refresh: () => run('refresh'),
        closeReauth() {
            if (signedOut) return;
            ++ticket; sessionCoordinator.begin(); flight=null; suspend();
            update({reauthOpen:false,busy:false});
        },
        openReauth() { if (!signedOut) update({reauthOpen:true}); },
        signoutLocal() {
            if (!client || disposed || signedOut && snapshot.localSignoutConfirmed === true) return Promise.resolve();
            if (signoutFlight) return signoutFlight;
            const retry = signedOut, own = ++ticket;
            if(!retry){signoutClient=client;signoutMode=config?.auth_mode??null;}
            const originalClient=signoutClient??client;
            flight = null;
            const operation = sessionCoordinator.begin();
            signedOut = true; loginRequired=false;
            if (!retry) retire();
            phase('anonymous');
            update({busy:true,signedOutLocally:true,localSignoutConfirmed:false,serverRevocation:signoutMode==='legacy_password'?'not-performed':'unconfirmed',reauthOpen:true});
            const task=(async()=>{
                try {
                    const result=await originalClient.signoutLocal(operation,retry);
                    if (!disposed && own===ticket) update({localSignoutConfirmed:result.localConfirmed,serverRevocation:result.serverRevocation,issue:result.localConfirmed?null:'connection'});
                } catch { if (!disposed && own===ticket) update({issue:'connection'}); }
                finally { if (!disposed && own===ticket) update({busy:false}); }
            })();
            signoutFlight=task;
            void task.finally(()=>{if(signoutFlight===task)signoutFlight=null;});
            return task;
        },
        // Explicit provider-account boundary notification only; never infer continuity from a URL.
        retirePrivacyContext() { ++ticket; sessionCoordinator.begin(); flight = null; retire(); update({ busy: false, providerChecking: false }); },
        dispose() { disposed = true; ++ticket; unsubscribe(); window.removeEventListener('storage', storageChanged); listeners.clear(); suspendTurnTarget(); },
    };
}
export type SessionController = ReturnType<typeof createSessionController>;
