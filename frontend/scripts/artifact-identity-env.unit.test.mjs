import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEnvironment } from './artifact-identity.mjs'

test('build environment drops secrets/injection but preserves opaque TLS transport', () => {
  const env = buildEnvironment({ PATH: '/bin', HOME: '/private', OPENAI_API_KEY: 'secret', NODE_OPTIONS: '--require=evil', NODE_TLS_REJECT_UNAUTHORIZED: '0', HTTPS_PROXY: 'https://secret@proxy', NODE_EXTRA_CA_CERTS: '/platform/ca', NEXT_PUBLIC_API_URL: 'poison' }, '/fixture/home')
  assert.equal(env.HTTPS_PROXY, 'https://secret@proxy')
  assert.equal(env.NODE_EXTRA_CA_CERTS, '/platform/ca')
  assert.equal(env.HOME, '/fixture/home')
  for (const key of ['OPENAI_API_KEY', 'NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NEXT_PUBLIC_API_URL']) assert.equal(env[key], undefined)
})
