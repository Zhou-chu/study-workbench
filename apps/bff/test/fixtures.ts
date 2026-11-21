import type { BffConfig } from '../src/config.js';
export const origin = 'https://workbench.example';
export function config(mode: BffConfig['mode'] = 'legacy_password'): BffConfig {
    return { mode, publicOrigin: origin, internalOrigin: 'http://fixed-upstream.invalid', cookieName: '__Host-sw-session', secure: true, nativePassthrough: false, webSessionProtocol: mode === 'device_sessions' ? 'bff-memory-v1' : null };
}
export const rejectedTargets: Array<[
    string,
    string,
    number
]> = [
    ['GET', '/api/commands/registry/debug', 404], ['GET', '/api/unknown', 404], ['GET', '/api/notebooks/one/extra', 404],
    ['GET', '/api/models/one', 405], ['TRACE', '/api/notebooks', 405], ['PATCH', '/api/notebooks', 405], ['HEAD', '/api/notebooks', 405],
    ['OPTIONS', '/api/unknown', 404], ['GET', '/api/%6eotebooks', 404], ['GET', '/api//notebooks', 404], ['GET', '/api/notebooks/', 404],
    ['GET', '/api/./notebooks', 404], ['GET', '/api/notes/../notebooks', 404], ['GET', '/api/notes/%2E%2e', 404],
    ['GET', '/api/notes/.%2e', 404], ['GET', '/api/notes/%252e%252e', 404], ['GET', '/api/notes/part%2Fother', 404],
    ['GET', '/api/notes/part%5cother', 404], ['GET', '/api/notes/%252Fother', 404], ['GET', '/api/notes/%255Cother', 404],
    ['GET', '/api/notes/part%3fquery', 404], ['GET', '/api/notes/part%23hash', 404], ['GET', '/api/notes/part\\other', 404],
    ['GET', '/api/notes/part%00other', 404], ['GET', '/api/notes/part%7Fother', 404], ['GET', '/api/notes/%', 404],
    ['GET', '/api/notes/%C0%AF', 404], ['GET', '/api/notes/%ZZ', 404], ['GET', '/api/notebooks?query=%ZZ', 404],
    ['GET', '/api/notebooks?query=%0a', 404], ['GET', '/api/notebooks#ignored', 404], ['GET', '//evil.example/api/notebooks', 404],
    ['POST', '/api/%61uth/sessions', 404], ['POST', '/api/auth/%73essions', 404], ['POST', '/api/auth%2Fsessions', 404],
];
