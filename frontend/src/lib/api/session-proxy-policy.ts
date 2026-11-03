import { WEB_SESSION_PROTOCOL, type WebSessionMode } from '@/lib/types/config'

export interface WebSessionConfig {
  mode: WebSessionMode
  publicOrigin: string | null
  internalOrigin: string
  cookieName: '__Host-sw-session' | 'sw-session'
  secure: boolean
  nativePassthrough: boolean
  webSessionProtocol: typeof WEB_SESSION_PROTOCOL | null
}

/** Safe reads may omit Origin; any supplied origin/site must be acceptable.
 * This examines no Cookie or Authorization and grants no session authority. */
export function isAllowedWebRead(headers: Headers, publicOrigin: string | null): boolean {
  const origin = headers.get('origin')
  const site = headers.get('sec-fetch-site')
  return (origin === null || origin === publicOrigin)
    && (site === null || ['none', 'same-origin', 'same-site'].includes(site))
}

function unavailable(): never {
  // Never include the invalid configuration value in errors or logs.
  throw new Error('AUTH_UNAVAILABLE')
}

function booleanFlag(value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false
  if (value === 'true') return true
  return unavailable()
}

function exactOrigin(value: string, allowTrailingSlash = false): URL {
  try {
    const url = new URL(value)
    const expected = allowTrailingSlash && value.endsWith('/') ? `${url.origin}/` : url.origin
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || value !== expected || value.includes('*')) return unavailable()
    return url
  } catch {
    return unavailable()
  }
}

/** Server configuration only. Caller-supplied headers/URLs never select an origin. */
export function getWebSessionConfig(): WebSessionConfig {
  const mode = process.env.STUDY_WORKBENCH_AUTH_MODE ?? 'legacy_password'
  if (mode !== 'legacy_password' && mode !== 'device_sessions') return unavailable()

  const nativePassthrough = booleanFlag(process.env.STUDY_WORKBENCH_WEB_NATIVE_PASSTHROUGH)
  const allowLoopback = booleanFlag(process.env.STUDY_WORKBENCH_WEB_ALLOW_INSECURE_LOOPBACK)
  const internalOrigin = exactOrigin(process.env.INTERNAL_API_URL ?? 'http://localhost:5055', true).origin
  const base = { mode, internalOrigin, nativePassthrough } as const
  if (mode === 'legacy_password') {
    return { ...base, publicOrigin: null, cookieName: '__Host-sw-session', secure: true, webSessionProtocol: null }
  }

  const configuredOrigin = process.env.STUDY_WORKBENCH_WEB_ORIGIN
  if (configuredOrigin === undefined) return unavailable()
  const publicUrl = exactOrigin(configuredOrigin)
  const secure = publicUrl.protocol === 'https:'
  if (!secure && (!allowLoopback || process.env.NODE_ENV === 'production'
    || !['127.0.0.1', '[::1]'].includes(publicUrl.hostname))) return unavailable()

  const origins = (process.env.STUDY_WORKBENCH_AUTH_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean)
  for (const origin of origins) exactOrigin(origin)
  if (!origins.includes(configuredOrigin)) return unavailable()

  return {
    ...base, publicOrigin: configuredOrigin, cookieName: secure ? '__Host-sw-session' : 'sw-session',
    secure, webSessionProtocol: WEB_SESSION_PROTOCOL,
  }
}

export type RouteKind = 'json' | 'multipart' | 'sse' | 'download' | 'auth' | 'public'
export type RouteHeaderClass = RouteKind
export interface RoutePolicy {
  readonly method: string
  readonly template: string
  readonly kind: RouteKind
  readonly headerClass: RouteHeaderClass
}

// Reviewed against contracts/v1/openapi.json and current browser API consumers.
// This is a static allowlist, never generated/expanded at runtime from the schema.
// /commands/registry/debug and other unconsumed operations remain excluded.
// modelsApi.get has no GET /models/{id} backend contract and is deliberately denied.
// HEAD is explicit only for the existing source download contract. OPTIONS never
// dispatches upstream; the common handler must answer/reject it locally.
const routeDefinitions: ReadonlyArray<readonly [string, string, RouteKind?]> = [
  ['GET', '/api/config', 'public'], ['GET', '/api/auth/status', 'public'],
  ['GET POST DELETE', '/api/auth/sessions', 'auth'],
  ['POST', '/api/auth/sessions/refresh', 'auth'], ['DELETE', '/api/auth/sessions/{session_id}', 'auth'],
  ['POST', '/api/auth/web-signout-local', 'auth'],
  ['GET', '/api/capabilities'], ['GET', '/api/providers'], ['GET', '/api/recently-viewed'],
  ['GET POST', '/api/notebooks'], ['GET PUT DELETE', '/api/notebooks/{notebook_id}'],
  ['GET', '/api/notebooks/{notebook_id}/delete-preview'],
  ['POST DELETE', '/api/notebooks/{notebook_id}/sources/{source_id}'],
  ['GET POST', '/api/notes'], ['GET PUT DELETE', '/api/notes/{note_id}'],
  ['GET', '/api/sources'], ['POST', '/api/sources', 'multipart'], ['GET PUT DELETE', '/api/sources/{source_id}'],
  ['GET', '/api/sources/{source_id}/status'], ['POST', '/api/sources/{source_id}/retry'],
  ['GET HEAD', '/api/sources/{source_id}/download', 'download'],
  ['GET POST', '/api/sources/{source_id}/insights'], ['GET DELETE', '/api/insights/{insight_id}'],
  ['GET', '/api/commands/jobs/{job_id}'],
  ['GET POST', '/api/chat/sessions'], ['GET PUT DELETE', '/api/chat/sessions/{session_id}'],
  ['POST', '/api/chat/context'], ['POST', '/api/chat/execute'],
  ['GET POST', '/api/sources/{source_id}/chat/sessions'],
  ['GET PUT DELETE', '/api/sources/{source_id}/chat/sessions/{session_id}'],
  ['POST', '/api/sources/{source_id}/chat/sessions/{session_id}/messages', 'sse'],
  ['POST', '/api/search'], ['POST', '/api/search/ask', 'sse'],
  ['GET PUT', '/api/settings'], ['GET POST', '/api/transformations'],
  ['GET PUT', '/api/transformations/default-prompt'], ['POST', '/api/transformations/execute'],
  ['GET PUT DELETE', '/api/transformations/{transformation_id}'],
  ['POST', '/api/embed'], ['POST', '/api/embeddings/rebuild'],
  ['GET', '/api/embeddings/rebuild/{command_id}/status'],
  ['GET POST', '/api/models'], ['GET PUT', '/api/models/defaults'], ['GET', '/api/models/providers'],
  ['GET', '/api/models/discover/{provider}'], ['POST', '/api/models/sync/{provider}'],
  ['POST', '/api/models/sync'], ['GET', '/api/models/count/{provider}'],
  ['GET', '/api/models/by-provider/{provider}'], ['POST', '/api/models/auto-assign'],
  ['DELETE', '/api/models/{model_id}'], ['POST', '/api/models/{model_id}/test'],
  ['GET', '/api/credentials/status'], ['GET', '/api/credentials/env-status'],
  ['GET POST', '/api/credentials'], ['GET', '/api/credentials/by-provider/{provider}'],
  ['GET PUT DELETE', '/api/credentials/{credential_id}'], ['POST', '/api/credentials/{credential_id}/test'],
  ['POST', '/api/credentials/{credential_id}/discover'], ['POST', '/api/credentials/{credential_id}/register-models'],
  ['POST', '/api/credentials/migrate-from-provider-config'], ['POST', '/api/credentials/migrate-from-env'],
  ['GET', '/api/podcasts/episodes'], ['DELETE', '/api/podcasts/episodes/{episode_id}'],
  ['POST', '/api/podcasts/episodes/{episode_id}/retry'], ['GET', '/api/podcasts/episodes/{episode_id}/audio', 'download'],
  ['POST', '/api/podcasts/generate'], ['GET', '/api/languages'],
  ['GET POST', '/api/episode-profiles'], ['PUT DELETE', '/api/episode-profiles/{profile_id}'],
  ['POST', '/api/episode-profiles/{profile_id}/duplicate'],
  ['GET POST', '/api/speaker-profiles'], ['PUT DELETE', '/api/speaker-profiles/{profile_id}'],
  ['POST', '/api/speaker-profiles/{profile_id}/duplicate'],
  ['GET', '/api/personal/notebooks/{notebook_id}/workspace'],
  ['GET POST', '/api/personal/notebooks/{notebook_id}/semantic-index'],
  ['POST', '/api/personal/notebooks/{notebook_id}/semantic-index/preview'],
  ['PATCH', '/api/personal/notebooks/{notebook_id}/selection'],
  ['POST', '/api/personal/notebooks/{notebook_id}/sources/upload', 'multipart'],
  ['GET', '/api/personal/web-search/status'], ['POST', '/api/personal/web-search'],
  ['POST', '/api/personal/notebooks/{notebook_id}/sources/web-import'],
  ['POST', '/api/personal/notebooks/{notebook_id}/source-snapshots'],
  ['GET POST', '/api/personal/chats/{chat_session_id}/turns'],
  ['GET', '/api/personal/turns/{turn_id}/events', 'sse'],
  ['POST', '/api/personal/notebooks/{notebook_id}/notes'],
  ['PATCH', '/api/personal/notebooks/{notebook_id}/notes/{note_id}'],
  ['GET', '/api/personal/jobs/{job_id}'], ['POST', '/api/personal/jobs/{job_id}/cancel'],
  ['POST', '/api/personal/source-versions/{source_version_id}/revalidate'],
  ['POST', '/api/personal/source-versions/{source_version_id}/reparse'], ['POST', '/api/personal/search'],
  ['GET', '/api/personal/sources/{source_id}/versions'], ['GET', '/api/personal/source-versions/{source_version_id}'],
  ['GET', '/api/personal/evidence/{evidence_id}'],
  ['GET', '/api/personal/source-versions/{source_version_id}/download', 'download'],
  ['GET', '/api/personal/portable/limits'], ['POST', '/api/personal/notebooks/{notebook_id}/exports'],
  ['POST', '/api/personal/imports/portable', 'multipart'],
  ['GET', '/api/personal/exports/{export_id}/download', 'download'],
  ['GET', '/api/personal/artifacts/{artifact_id}/download', 'download'],
  ['GET DELETE', '/api/personal/connections/notebooklm'],
  ['POST', '/api/personal/connections/notebooklm/connect'], ['POST', '/api/personal/connections/notebooklm/reconnect'],
  ['GET', '/api/personal/connections/notebooklm/connect/{flow_id}'],
  ['GET', '/api/personal/notebooklm/capabilities'], ['GET POST', '/api/personal/notebooklm/notebooks'],
  ['GET', '/api/personal/notebooklm/notebooks/{remote_notebook_id}/sources'],
  ['GET', '/api/personal/notebooklm/notebooks/{remote_notebook_id}/artifacts'],
  ['POST', '/api/personal/notebooks/{notebook_id}/notebooklm-link'],
  ['POST', '/api/personal/notebooks/{notebook_id}/notebooklm-source-link'],
  ['POST', '/api/personal/notebooks/{notebook_id}/sync/notebooklm'],
  ['POST', '/api/personal/notebooks/{notebook_id}/imports/notebooklm'],
  ['POST', '/api/personal/notebooks/{notebook_id}/artifacts/audio'],
  ['POST', '/api/personal/notebooklm/artifacts/{remote_artifact_id}/download'],
]

const routes = routeDefinitions.flatMap(([methods, template, kind = 'json']) =>
  methods.split(' ').map(method => ({
    policy: Object.freeze({ method, template, kind, headerClass: kind }),
    segments: template.split('/'),
  })))

// RegExp constructor avoids embedding invisible control characters in source.
const controlCharacters = new RegExp('[\\x00-\\x1f\\x7f]')

/**
 * Validate the original relative URL BEFORE parsing or forwarding it. Next route
 * params are already decoded and must not be used to reconstruct the input here.
 * Query values are not routing: ordinary encoded slashes/URL text remain intact.
 */
export function matchApiRoute(method: string, rawUrl: string): RoutePolicy | null {
  if (!rawUrl.startsWith('/api/') || rawUrl.includes('\\') || rawUrl.includes('#')
    || controlCharacters.test(rawUrl)) return null
  const question = rawUrl.indexOf('?')
  const rawPath = question === -1 ? rawUrl : rawUrl.slice(0, question)
  const segments = rawPath.split('/')
  try {
    if (segments.slice(1).some(segment => !segment)) return null
    for (const segment of segments.slice(1)) {
      const decoded = decodeURIComponent(segment)
      if (decoded === '.' || decoded === '..' || /[\\/?#]/.test(decoded)
        || /%[a-f\d]{2}/i.test(decoded) || controlCharacters.test(decoded)) return null
    }
    if (question !== -1 && controlCharacters.test(decodeURIComponent(rawUrl.slice(question + 1)))) return null
    // WHATWG URL parsing must not silently fix routing or query syntax. Raw
    // Unicode IDs are equivalent to their UTF-8 spelling; retain the raw URL.
    const encodedUnicode = Array.from(rawUrl).map(character =>
      character.charCodeAt(0) > 127 ? encodeURIComponent(character) : character).join('')
    const parsed = new URL(rawUrl, 'https://policy.invalid')
    if (`${parsed.pathname}${parsed.search}` !== encodedUnicode
      // URL.search drops a sole trailing '?', which has no query semantics.
      && !(`${parsed.pathname}?` === encodedUnicode && rawUrl.endsWith('?'))) return null
  } catch {
    return null
  }

  return routes.find(route => route.policy.method === method && route.segments.length === segments.length
    && route.segments.every((segment, index) => segment.startsWith('{') || segment === segments[index]))?.policy ?? null
}
