import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const load = async () => {
  const filename = new URL('./artifact-identity.mjs', import.meta.url)
  await assert.doesNotReject(() => readFile(filename), 'artifact identity implementation missing')
  return import(filename)
}

async function fixture(t) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'sw-artifact-test-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  await mkdir(path.join(temp, 'contracts/v1'), { recursive: true })
  await writeFile(path.join(temp, 'contracts/v1/openapi.json'), '{}')
  const source = path.join(temp, 'frontend')
  for (const dir of ['src', 'public', 'scripts']) await mkdir(path.join(source, dir), { recursive: true })
  for (const [name, value] of Object.entries({ 'package.json': '{}', 'package-lock.json': '{}', 'next.config.ts': 'export default {}', 'tsconfig.json': '{}', 'postcss.config.mjs': 'export default {}', 'start-server.js': '// start', 'src/page.tsx': 'public source', 'public/logo.svg': '<svg/>', 'scripts/prepare-pdf-assets.mjs': '// fixture' })) await writeFile(path.join(source, name), value)
  return { temp, source }
}

async function fakeBuild(source) {
  for (const dir of ['.next/standalone/.next/server', '.next/static', 'public/pdfjs/6.4.299']) await mkdir(path.join(source, dir), { recursive: true })
  await writeFile(path.join(source, '.next/standalone/server.js'), '// served')
  await writeFile(path.join(source, '.next/standalone/.next/server/page.js'), '// page')
  await writeFile(path.join(source, '.next/static/chunk.js'), '// chunk')
  await writeFile(path.join(source, 'public/pdfjs/6.4.299/worker.mjs'), '// generated')
}

async function build(t, change) {
  const lib = await load()
  const tree = await fixture(t)
  const result = await lib.buildArtifact({ source: tree.source, outputParent: tree.temp, inheritedEnv: { PATH: process.env.PATH }, prepare: async () => fakeBuild(tree.source), compile: async () => { if (change) await change(tree.source) }, toolVersions: { node: 'test-node', npm: 'test-npm' } })
  return { lib, ...tree, ...result }
}

test('fresh package verifies and includes standalone/static/public/generated assets', async t => {
  const { lib, source, artifact, manifest } = await build(t)
  const verified = await lib.verifyArtifact(source, artifact)
  assert.equal(verified.manifest_sha256, lib.digest(manifest))
  assert.ok(manifest.artifact.files['server.js'])
  assert.ok(manifest.artifact.files['.next/static/chunk.js'])
  assert.ok(manifest.artifact.files['public/logo.svg'])
  assert.ok(manifest.generated.files['6.4.299/worker.mjs'])
  assert.equal(manifest.claim, 'source-artifact-association-not-reproducibility')
})

for (const filename of ['src/page.tsx', 'public/logo.svg', 'package-lock.json', 'next.config.ts', 'scripts/prepare-pdf-assets.mjs']) test(`changed ${filename} rejects stale artifact`, async t => {
  const { lib, source, artifact } = await build(t)
  await writeFile(path.join(source, filename), 'changed')
  await assert.rejects(() => lib.verifyArtifact(source, artifact), /source.*changed/)
})

test('changed served artifact rejects', async t => {
  const { lib, source, artifact } = await build(t)
  await writeFile(path.join(artifact, 'server.js'), 'changed')
  await assert.rejects(() => lib.verifyArtifact(source, artifact), /artifact.*changed/)
})

test('change during build rejects and invalidates old success receipt', async t => {
  const { lib, source, artifact, temp } = await build(t)
  await assert.rejects(() => lib.buildArtifact({ source, outputParent: temp, inheritedEnv: {}, prepare: async () => fakeBuild(source), compile: async () => writeFile(path.join(source, 'src/page.tsx'), 'changed during build'), toolVersions: {} }), /source.*changed/)
  await assert.rejects(() => lib.verifyArtifact(source, artifact), /successful build receipt/)
})

test('failed build cannot reuse an older matching source manifest', async t => {
  const { lib, source, artifact, temp } = await build(t)
  await assert.rejects(() => lib.buildArtifact({ source, outputParent: temp, inheritedEnv: {}, prepare: async () => fakeBuild(source), compile: async () => { throw new Error('fake build failed') }, toolVersions: {} }), /fake build failed/)
  await assert.rejects(() => lib.verifyArtifact(source, artifact), /successful build receipt/)
})

for (const filename of ['.env.production.local', 'public/operator.secret', 'src/key.pem', 'public/.npmrc', 'src/credentials.json']) test(`private candidate ${filename} rejected before content read`, async t => {
  const lib = await load()
  const { source } = await fixture(t)
  await symlink('/definitely/not/read', path.join(source, filename))
  await assert.rejects(() => lib.sourceInventory(source), /private|dotenv/)
})

test('source symlink escape is rejected', async t => {
  const lib = await load()
  const { source } = await fixture(t)
  await symlink('/definitely/not/read', path.join(source, 'src/escape.ts'))
  await assert.rejects(() => lib.sourceInventory(source), /symlink/)
})

test('artifact allows relative internal dependency links, rejects external links', async t => {
  const { lib, artifact, temp } = await build(t)
  await mkdir(path.join(artifact, 'node_modules/pkg'), { recursive: true })
  await writeFile(path.join(artifact, 'node_modules/pkg/index.js'), '// dependency')
  await symlink('pkg', path.join(artifact, 'node_modules/alias'))
  const inventory = await lib.treeInventory(artifact, { internalLinks: true, exclude: new Set(['artifact-manifest.json']) })
  assert.equal(inventory.files['node_modules/alias'].link, 'pkg')
  await symlink(temp, path.join(artifact, 'node_modules/escape'))
  await assert.rejects(() => lib.treeInventory(artifact, { internalLinks: true }), /symlink.*escape/)
})

test('build environment drops secrets/injection but preserves opaque TLS transport', async () => {
  const lib = await load()
  const env = lib.buildEnvironment({ PATH: '/bin', HOME: '/private', OPENAI_API_KEY: 'secret', NODE_OPTIONS: '--require=evil', NODE_TLS_REJECT_UNAUTHORIZED: '0', HTTPS_PROXY: 'https://secret@proxy', NODE_EXTRA_CA_CERTS: '/platform/ca', NEXT_PUBLIC_API_URL: 'poison' }, '/fixture/home')
  assert.equal(env.HTTPS_PROXY, 'https://secret@proxy')
  assert.equal(env.NODE_EXTRA_CA_CERTS, '/platform/ca')
  assert.equal(env.HOME, '/fixture/home')
  for (const key of ['OPENAI_API_KEY', 'NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NEXT_PUBLIC_API_URL']) assert.equal(env[key], undefined)
})

test('external public contract participates in input identity', async t => {
  const { lib, source, artifact, temp } = await build(t)
  await writeFile(path.join(temp, 'contracts/v1/openapi.json'), '{"changed": true}')
  await assert.rejects(() => lib.verifyArtifact(source, artifact), /source.*changed/)
})

test('unexpected output directory fails closed without traversing it', async t => {
  const lib = await load()
  const { source } = await fixture(t)
  await mkdir(path.join(source, 'doc_exports'))
  await symlink('/definitely/not/read', path.join(source, 'doc_exports/private.ts'))
  await assert.rejects(() => lib.sourceInventory(source), /unsupported source directory/)
})

test('concurrent build refuses shared output; verifier refuses active build', async t => {
  const { lib, source, artifact, temp } = await build(t)
  let started
  const paused = new Promise(resolve => { started = resolve })
  let resume
  const barrier = new Promise(resolve => { resume = resolve })
  const first = lib.buildArtifact({ source, outputParent: temp, inheritedEnv: {}, prepare: async () => { await fakeBuild(source); started(); await barrier }, compile: async () => {}, toolVersions: {} })
  await paused
  try {
    await assert.rejects(() => lib.buildArtifact({ source, outputParent: temp, prepare: async () => {}, compile: async () => {} }), /build.*active/)
    await assert.rejects(() => lib.verifyArtifact(source, artifact), /build.*active/)
  } finally { resume(); await first }
})

test('runtime result metadata is not read; unknown runtime entries reject', async t => {
  const lib = await load()
  const { source } = await fixture(t)
  await mkdir(path.join(source, 'test-results'))
  await writeFile(path.join(source, 'test-results/.last-run.json'), 'not JSON')
  const before = await lib.sourceInventory(source)
  await writeFile(path.join(source, 'test-results/.last-run.json'), 'different metadata')
  assert.deepEqual(await lib.sourceInventory(source), before)
  await mkdir(path.join(source, 'test-results/private-output'))
  await assert.rejects(() => lib.sourceInventory(source), /unexpected runtime output/)
})

test('public dependency reader rejects symlink and bounded oversized file', async t => {
  const lib = await load()
  const { temp } = await fixture(t)
  await symlink('/definitely/not/read', path.join(temp, 'package.json'))
  await assert.rejects(() => lib.readPublicFile(path.join(temp, 'package.json')), /symlink/)
  await writeFile(path.join(temp, 'large.json'), '1234')
  await assert.rejects(() => lib.readPublicFile(path.join(temp, 'large.json'), 2), /bounded regular/)
})

test('FIFO manifest fails promptly rather than waiting for a writer', async t => {
  const { source, artifact } = await build(t)
  const { spawnSync } = await import('node:child_process')
  const manifest = path.join(artifact, 'artifact-manifest.json')
  await rm(manifest)
  const fifo = spawnSync('mkfifo', [manifest], { env: { PATH: process.env.PATH } })
  assert.equal(fifo.status, 0)
  const moduleURL = new URL('./artifact-identity.mjs', import.meta.url).href
  const code = `import { verifyArtifact } from ${JSON.stringify(moduleURL)}; try { await verifyArtifact(${JSON.stringify(source)}, ${JSON.stringify(artifact)}); process.exit(1) } catch { process.exit(0) }`
  const checked = spawnSync(process.execPath, ['--input-type=module', '-e', code], { timeout: 3000, env: { PATH: process.env.PATH }, stdio: 'ignore' })
  assert.equal(checked.error, undefined)
  assert.equal(checked.status, 0)
})

test('generated asset drift rejects independently of authored source', async t => {
  const { lib, source, artifact } = await build(t)
  await writeFile(path.join(source, 'public/pdfjs/6.4.299/worker.mjs'), '// changed generated asset')
  await assert.rejects(() => lib.verifyArtifact(source, artifact), /generated.*changed/)
})

test('missing and malformed manifests fail closed', async t => {
  const { lib, source, artifact } = await build(t)
  await writeFile(path.join(artifact, 'artifact-manifest.json'), '{')
  await assert.rejects(() => lib.verifyArtifact(source, artifact))
  await rm(path.join(artifact, 'artifact-manifest.json'))
  await assert.rejects(() => lib.verifyArtifact(source, artifact))
})


test('legacy standalone tracing root stays local when repository workspaces exist', async () => {
  const { createRequire } = await import('node:module')
  const { fileURLToPath } = await import('node:url')
  const require = createRequire(import.meta.url)
  const loadConfig = require('next/dist/server/config.js').default
  const { PHASE_PRODUCTION_BUILD } = require('next/constants')
  const source = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
  const rootPackage = JSON.parse(await readFile(path.join(source, '../package.json'), 'utf8'))
  assert.deepEqual(rootPackage.workspaces, ['apps/*', 'packages/*'])
  assert.ok((await readFile(path.join(source, '../package-lock.json'))).length)
  const config = await loadConfig(PHASE_PRODUCTION_BUILD, source, { silent: true })
  assert.equal(config.outputFileTracingRoot, source)
})
