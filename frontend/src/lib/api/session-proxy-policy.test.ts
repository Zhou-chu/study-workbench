import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import schema from '../../../../contracts/v1/openapi.json'
import { getWebSessionConfig, isAllowedWebRead, matchApiRoute } from './session-proxy-policy'

const WEB_ORIGIN = 'https://workbench.example'
const deviceEnv = () => {
  vi.stubEnv('STUDY_WORKBENCH_AUTH_MODE', 'device_sessions')
  vi.stubEnv('STUDY_WORKBENCH_WEB_ORIGIN', WEB_ORIGIN)
  vi.stubEnv('STUDY_WORKBENCH_AUTH_ORIGINS', `https://other.example, ${WEB_ORIGIN}`)
}

beforeEach(() => {
  for (const key of ['STUDY_WORKBENCH_AUTH_MODE', 'STUDY_WORKBENCH_WEB_ORIGIN',
    'STUDY_WORKBENCH_AUTH_ORIGINS', 'STUDY_WORKBENCH_WEB_NATIVE_PASSTHROUGH',
    'STUDY_WORKBENCH_WEB_ALLOW_INSECURE_LOOPBACK', 'INTERNAL_API_URL']) {
    vi.stubEnv(key, undefined)
  }
})
afterEach(() => vi.unstubAllEnvs())

describe('metadata safe-read boundary', () => {
  const allowedHeaders: Record<string, string>[] = [{}, { origin: WEB_ORIGIN }, { 'sec-fetch-site': 'same-origin' },
    { origin: WEB_ORIGIN, 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'none' }]
  it.each(allowedHeaders)('allows absent/exact origin and safe metadata %j', headers => {
    expect(isAllowedWebRead(new Headers(headers), WEB_ORIGIN)).toBe(true)
  })
  const rejectedHeaders: Record<string, string>[] = [{ origin: 'https://foreign.example' }, { origin: 'null' }, { origin: '' },
    { origin: `${WEB_ORIGIN}/` }, { origin: `${WEB_ORIGIN}, ${WEB_ORIGIN}` },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': '' }, { 'sec-fetch-site': 'SAME-ORIGIN' }]
  it.each(rejectedHeaders)('rejects foreign/ambiguous origin or metadata %j', headers => {
    expect(isAllowedWebRead(new Headers(headers), WEB_ORIGIN)).toBe(false)
  })
})

describe('getWebSessionConfig', () => {
  it('defaults only absent mode to legacy with native passthrough disabled', () => {
    expect(getWebSessionConfig()).toEqual({
      mode: 'legacy_password', publicOrigin: null, internalOrigin: 'http://localhost:5055',
      cookieName: '__Host-sw-session', secure: true, nativePassthrough: false,
      webSessionProtocol: null,
    })
    vi.stubEnv('STUDY_WORKBENCH_AUTH_MODE', 'legacy_password')
    expect(getWebSessionConfig().mode).toBe('legacy_password')
  })

  it.each(['', ' ', 'DEVICE_SESSIONS', 'false', 'unknown'])('rejects explicit mode %j', mode => {
    vi.stubEnv('STUDY_WORKBENCH_AUTH_MODE', mode)
    expect(() => getWebSessionConfig()).toThrow('AUTH_UNAVAILABLE')
  })

  it('returns fixed server-only destination and stable Web protocol metadata', () => {
    deviceEnv()
    vi.stubEnv('INTERNAL_API_URL', 'http://api:5055')
    vi.stubEnv('API_URL', 'https://external.example')
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://external.example')
    expect(getWebSessionConfig()).toEqual({
      mode: 'device_sessions', publicOrigin: WEB_ORIGIN, internalOrigin: 'http://api:5055',
      cookieName: '__Host-sw-session', secure: true, nativePassthrough: false,
      webSessionProtocol: 'bff-memory-v1',
    })
  })

  it.each([undefined, '', 'http://workbench.example', 'https://workbench.example/',
    'https://workbench.example/path', 'https://u:p@workbench.example',
    'https://workbench.example?', 'https://workbench.example#',
    'https://workbench.example:443', 'https://WORKBENCH.example',
    ' https://workbench.example', 'https://workbench.example https://evil.example',
    'https://workbench.example,https://evil.example', 'https://*.example'])('rejects nonexact Web origin %j', origin => {
    deviceEnv()
    vi.stubEnv('STUDY_WORKBENCH_WEB_ORIGIN', origin)
    expect(() => getWebSessionConfig()).toThrow('AUTH_UNAVAILABLE')
  })

  it('requires the exact configured Web origin in the API allowlist', () => {
    deviceEnv()
    vi.stubEnv('STUDY_WORKBENCH_AUTH_ORIGINS', 'https://other.example')
    expect(() => getWebSessionConfig()).toThrow('AUTH_UNAVAILABLE')
    vi.stubEnv('STUDY_WORKBENCH_AUTH_ORIGINS', `${WEB_ORIGIN},https://other.example/path`)
    expect(() => getWebSessionConfig()).toThrow('AUTH_UNAVAILABLE')
  })

  it.each(['http://127.0.0.1:3000', 'http://[::1]:3000'])('allows explicit nonproduction literal loopback %s', origin => {
    deviceEnv()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('STUDY_WORKBENCH_WEB_ORIGIN', origin)
    vi.stubEnv('STUDY_WORKBENCH_AUTH_ORIGINS', origin)
    expect(() => getWebSessionConfig()).toThrow('AUTH_UNAVAILABLE')
    vi.stubEnv('STUDY_WORKBENCH_WEB_ALLOW_INSECURE_LOOPBACK', 'true')
    expect(getWebSessionConfig()).toMatchObject({ cookieName: 'sw-session', secure: false, publicOrigin: origin })
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => getWebSessionConfig()).toThrow('AUTH_UNAVAILABLE')
  })

  it.each(['http://localhost:3000', 'http://127.1:3000', 'http://2130706433:3000',
    'http://0.0.0.0:3000', 'http://local.example:3000', 'http://127.0.0.1.evil.example'])('never infers literal loopback from %s', origin => {
    deviceEnv()
    vi.stubEnv('STUDY_WORKBENCH_WEB_ORIGIN', origin)
    vi.stubEnv('STUDY_WORKBENCH_AUTH_ORIGINS', origin)
    vi.stubEnv('STUDY_WORKBENCH_WEB_ALLOW_INSECURE_LOOPBACK', 'true')
    expect(() => getWebSessionConfig()).toThrow('AUTH_UNAVAILABLE')
  })

  it.each(['', 'yes', '1', 'TRUE', ' false'])('rejects ambiguous boolean %j', value => {
    vi.stubEnv('STUDY_WORKBENCH_WEB_NATIVE_PASSTHROUGH', value)
    expect(() => getWebSessionConfig()).toThrow('AUTH_UNAVAILABLE')
    vi.stubEnv('STUDY_WORKBENCH_WEB_NATIVE_PASSTHROUGH', undefined)
    vi.stubEnv('STUDY_WORKBENCH_WEB_ALLOW_INSECURE_LOOPBACK', value)
    expect(() => getWebSessionConfig()).toThrow('AUTH_UNAVAILABLE')
  })

  it('accepts only explicit true to enable separately gated native passthrough', () => {
    vi.stubEnv('STUDY_WORKBENCH_WEB_NATIVE_PASSTHROUGH', 'false')
    expect(getWebSessionConfig().nativePassthrough).toBe(false)
    vi.stubEnv('STUDY_WORKBENCH_WEB_NATIVE_PASSTHROUGH', 'true')
    expect(getWebSessionConfig().nativePassthrough).toBe(true)
  })

  it.each(['', '//api:5055', 'ftp://api:5055', 'http://user:pass@api:5055',
    'http://api:5055/api', 'http://api:5055/../', 'http://api:5055?x=1', 'http://api:5055#x',
    'http://api:5055?', 'http://api:5055#', 'http://api:5055\\', ' http://api:5055',
    'http://api:5055\n'])('rejects unsafe fixed upstream %j', origin => {
    vi.stubEnv('INTERNAL_API_URL', origin)
    expect(() => getWebSessionConfig()).toThrow('AUTH_UNAVAILABLE')
  })

  it.each(['http://api:5055', 'https://api.example', 'http://[::1]:5055'])('accepts internal HTTP(S) authority %s', origin => {
    vi.stubEnv('INTERNAL_API_URL', origin)
    expect(getWebSessionConfig().internalOrigin).toBe(origin)
    vi.stubEnv('INTERNAL_API_URL', `${origin}/`)
    expect(getWebSessionConfig().internalOrigin).toBe(origin)
  })
})

// Deliberately checked-in review fixture, not permission generated from OpenAPI.
// Every addition requires review of both actual schema and current browser use.
const browserRoutes: Array<[string, string, string?]> = [
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

const examples = browserRoutes.flatMap(([methods, template, kind = 'json']) =>
  methods.split(' ').map(method => ({ method, template, kind, url: template.replace(/\{[^}]+\}/g, 'record:%E8%B5%84%E6%96%99') })))

describe('matchApiRoute', () => {
  it.each(examples)('allows reviewed $method $template as $kind', ({ method, template, kind, url }) => {
    expect(matchApiRoute(method, `${url}?scope=selected&name=a%2Fb%3Fc%23d&name=two+words`))
      .toEqual({ method, template, kind, headerClass: kind })
    if (template !== '/api/auth/web-signout-local') {
      expect(schema.paths[template as keyof typeof schema.paths]).toHaveProperty(method.toLowerCase())
    }
  })

  it('covers every static current apiClient operation without widening unsupported model GET', () => {
    const directory = path.join(process.cwd(), 'src/lib/api')
    const calls: Array<[string, string]> = []
    function example(node: ts.Expression): string[] {
      if (ts.isStringLiteralLike(node)) return [node.text]
      if (ts.isConditionalExpression(node)) return [...example(node.whenTrue), ...example(node.whenFalse)]
      if (ts.isTemplateExpression(node)) {
        return node.templateSpans.reduce((values, span) => values.flatMap(value =>
          example(span.expression).map(part => value + part + span.literal.text)), [node.head.text])
      }
      return ['record:%E8%B5%84%E6%96%99']
    }
    for (const filename of readdirSync(directory).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
      const source = ts.createSourceFile(filename, readFileSync(path.join(directory, filename), 'utf8'), ts.ScriptTarget.Latest, true)
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.expression.getText(source) === 'apiClient'
          && /^(get|post|put|patch|delete|head|options)$/.test(node.expression.name.text)) {
          const argument = node.arguments[0]
          // Returned download URLs are covered by the exact download fixtures above.
          if (argument && (ts.isStringLiteralLike(argument) || ts.isTemplateExpression(argument))) {
            for (const url of example(argument)) calls.push([node.expression.name.text.toUpperCase(), `/api${url}`])
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect(calls.length).toBeGreaterThan(100)
    for (const [method, url] of calls) {
      if (method === 'GET' && url === '/api/models/record:%E8%B5%84%E6%96%99') {
        expect(matchApiRoute(method, url)).toBeNull() // No corresponding backend operation.
      } else {
        expect(matchApiRoute(method, url), `${method} ${url}`).not.toBeNull()
      }
    }
  })

  it.each([
    ['GET', '/api/commands/registry/debug'], ['POST', '/api/commands/jobs'],
    ['GET', '/api/models/not-an-implemented-route'], ['GET', '/api/unknown'],
    ['TRACE', '/api/notebooks'], ['OPTIONS', '/api/notebooks'], ['HEAD', '/api/notebooks'],
    ['PATCH', '/api/notebooks'], ['get', '/api/notebooks'],
    ['GET', 'https://workbench.example/api/notebooks'], ['GET', '//evil.example/api/notebooks'],
    ['GET', '/api//notebooks'], ['GET', '/api/notebooks/'], ['GET', '/api/./notebooks'],
    ['GET', '/api/notes/../notebooks'], ['GET', '/api/notes/%2E%2e'],
    ['GET', '/api/notes/.%2e'], ['GET', '/api/notes/%252e%252e'],
    ['GET', '/api/notes/part%2Fother'], ['GET', '/api/notes/part%5cother'],
    ['GET', '/api/notes/%252Fother'], ['GET', '/api/notes/%255Cother'],
    ['GET', '/api/notes/part%3fquery'], ['GET', '/api/notes/part%23hash'],
    ['GET', '/api/notes/part\\other'], ['GET', '/api/notes/part\tother'],
    ['GET', '/api/notes/part\nother'], ['GET', '/api/notes/part%00other'],
    ['GET', '/api/notes/part%7Fother'], ['GET', '/api/notes/%'],
    ['GET', '/api/notes/%C0%AF'], ['GET', '/api/notes/%ZZ'],
    ['GET', '/api/notebooks?query=%ZZ'], ['GET', '/api/notebooks?query=%0a'],
    ['GET', '/api/notebooks#ignored'], ['GET', '/api/notes/<id>'],
    ['GET', '/api/notes/a b'], ['GET', '/api/notes/\ud800'],
  ])('denies malformed/unreviewed %s %j', (method, url) => {
    expect(matchApiRoute(method, url)).toBeNull()
  })

  it.each(['source:资料', 'source%3A%E8%B5%84%E6%96%99', 'source:📝', 'source:version..2'])('preserves legitimate ID %s', id => {
    expect(matchApiRoute('GET', `/api/sources/${id}`)).toMatchObject({ template: '/api/sources/{source_id}' })
  })

  it('does not treat encoded static names as reviewable routes', () => {
    expect(matchApiRoute('GET', '/api/%6eotebooks')).toBeNull()
    expect(matchApiRoute('POST', '/api/credentials/%6digrate-encryption')).toBeNull()
  })
})
