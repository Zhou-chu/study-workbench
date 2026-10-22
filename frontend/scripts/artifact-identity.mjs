/** Freshness/association checks, not a reproducible or hermetic build claim. */
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { cp, lstat, mkdir, mkdtemp, open, readdir, readlink, realpath, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const SCHEMA = 1
const MANIFEST = 'artifact-manifest.json'
const RECEIPT = '.next/acceptance-build.json'
const BUILD_LOCK = '.acceptance-build.lock'
const SOURCE_DIRS = new Set(['src', 'public', 'scripts', 'app', 'pages', 'components', 'styles', 'lib', 'e2e', 'design-skills'])
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', BUILD_LOCK])
const SKIP_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md', '.gitignore', 'next-env.d.ts'])
const REQUIRED = ['package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs', 'start-server.js']
const TRANSPORT = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE']

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const inside = (root, target) => target === root || target.startsWith(root + path.sep)

function rejectPrivate(name) {
  if (/^\.env(?:\.|$)/i.test(name) || /\.(?:secret|pem|key|p12|pfx)$/i.test(name) || /^(?:private|secrets|credentials|credentials\.json|storage_state\.json|\.runtime|\.ssh|\.aws|\.codex|\.docker|\.npmrc|\.pypirc|\.netrc|\.git-credentials)$/i.test(name) || /^service[-_]account.*\.json$/i.test(name)) throw new Error('private/dotenv path rejected before content read')
}

export async function noSymlinkPath(filename) {
  let current = path.resolve(filename)
  while (true) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('symlink path rejected') } catch (error) { if (error.code !== 'ENOENT') throw error }
    const parent = path.dirname(current)
    if (current === parent) return
    current = parent
  }
}

async function regularBytes(filename, maxSize = Infinity) {
  if (!(await lstat(filename)).isFile()) throw new Error('expected bounded regular file')
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > maxSize) throw new Error('expected bounded regular file')
    return { bytes: await handle.readFile(), info }
  } finally { await handle.close() }
}

export async function readPublicFile(filename, maxSize = 16 * 1024 * 1024) {
  await noSymlinkPath(filename)
  return (await regularBytes(filename, maxSize)).bytes
}

async function fileRecord(filename) {
  const { bytes, info } = await regularBytes(filename)
  return { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, executable: info.mode & 0o111 }
}

export async function treeInventory(root, { internalLinks = false, exclude = new Set() } = {}) {
  root = path.resolve(root)
  await noSymlinkPath(root)
  if (!(await lstat(root)).isDirectory()) throw new Error('inventory root must be directory')
  const files = {}
  async function walk(directory, prefix = '') {
    for (const name of (await readdir(directory)).sort()) {
      rejectPrivate(name)
      const relative = prefix ? `${prefix}/${name}` : name
      const filename = path.join(directory, name)
      const info = await lstat(filename)
      if (info.isSymbolicLink()) {
        if (!internalLinks || !relative.startsWith('node_modules/')) throw new Error('source/nondependency symlink rejected')
        const link = await readlink(filename)
        const target = await realpath(filename)
        if (path.isAbsolute(link) || !inside(path.join(root, 'node_modules'), target)) throw new Error('dependency symlink escape rejected')
        for (const part of path.relative(root, target).split(path.sep)) rejectPrivate(part)
        files[relative] = { link }
      } else if (exclude.has(relative)) {
        continue
      } else if (info.isDirectory()) {
        await walk(filename, relative)
      } else if (info.isFile()) {
        files[relative] = await fileRecord(filename)
      } else {
        throw new Error('special file rejected before content read')
      }
    }
  }
  await walk(root)
  return { files, sha256: digest(files) }
}

export async function sourceInventory(source) {
  source = path.resolve(source)
  await noSymlinkPath(source)
  const files = {}
  const names = (await readdir(source)).sort()
  // Check root private names before reading any selected content.
  for (const name of names) rejectPrivate(name)
  for (const name of names) {
    const filename = path.join(source, name)
    if (SKIP_DIRS.has(name) || SKIP_FILES.has(name) || name.endsWith('.tsbuildinfo') || /^(?:npm|yarn|pnpm)-debug\.log/.test(name)) continue
    const info = await lstat(filename)
    if (info.isSymbolicLink()) throw new Error('source symlink rejected')
    if (name === 'test-results' && info.isDirectory()) {
      // Existing tracked runner metadata is not a build input. Inspect names and
      // types only; never recurse into runtime output or read its contents.
      for (const entry of await readdir(filename)) {
        if (entry !== '.last-run.json' || !(await lstat(path.join(filename, entry))).isFile()) throw new Error('unexpected runtime output; do not build from populated test-results')
      }
      continue
    }
    if (info.isDirectory()) {
      if (!SOURCE_DIRS.has(name)) throw new Error('unsupported source directory; extend bounded inventory explicitly')
      const subtree = await treeInventory(filename, { exclude: name === 'public' ? new Set(['pdfjs']) : new Set() })
      for (const [relative, record] of Object.entries(subtree.files)) files[`${name}/${relative}`] = record
    } else if (info.isFile()) {
      if (!/\.(?:[cm]?[jt]sx?|json|css|scss|sass|less|svg|png|jpe?g|webp|woff2?|ttf|ico|wasm|ya?ml)$/.test(name) && !['.babelrc', '.browserslistrc', 'browserslist'].includes(name)) throw new Error('unsupported root input; extend bounded inventory explicitly')
      files[name] = await fileRecord(filename)
    } else throw new Error('special source file rejected')
  }
  for (const name of REQUIRED) if (!files[name]) throw new Error('required build input missing')
  // This public JSON is imported by a TS test included in the production typecheck.
  const contract = path.resolve(source, '../contracts/v1/openapi.json')
  await noSymlinkPath(contract)
  files['../contracts/v1/openapi.json'] = await fileRecord(contract)
  return { files, sha256: digest(files) }
}

export function buildEnvironment(inherited, home) {
  const env = {}
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', ...TRANSPORT]) if (inherited[key] !== undefined) env[key] = inherited[key]
  if (inherited.NODE_USE_ENV_PROXY === '1') env.NODE_USE_ENV_PROXY = '1'
  return { ...env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache'), NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', TZ: 'UTC' }
}

async function atomicJSON(filename, value) {
  await noSymlinkPath(filename)
  const temporary = `${filename}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  await rename(temporary, filename)
}

async function readJSON(filename) {
  await noSymlinkPath(filename)
  return JSON.parse((await regularBytes(filename, 16 * 1024 * 1024)).bytes.toString('utf8'))
}

async function requireNoBuild(source) {
  try { await lstat(path.join(source, BUILD_LOCK)); throw new Error('frontend build is active (or stale lock needs operator review)') } catch (error) { if (error.code !== 'ENOENT') throw error }
}

export async function verifyArtifact(source, artifact) {
  source = path.resolve(source)
  artifact = path.resolve(artifact)
  await requireNoBuild(source)
  const receipt = await readJSON(path.join(source, RECEIPT)).catch(() => { throw new Error('successful build receipt missing or invalid') })
  if (receipt.schema !== SCHEMA || receipt.status !== 'passed') throw new Error('successful build receipt required')
  const manifest = await readJSON(path.join(artifact, MANIFEST))
  if (manifest.schema !== SCHEMA || manifest.claim !== 'source-artifact-association-not-reproducibility' || receipt.manifest_sha256 !== digest(manifest) || receipt.build_id !== manifest.build_id) throw new Error('stale/invalid artifact manifest')
  const sourceNow = await sourceInventory(source)
  if (digest(sourceNow) !== digest(manifest.input)) throw new Error('source inputs changed since successful build')
  const generated = await treeInventory(path.join(source, 'public/pdfjs'))
  if (digest(generated) !== digest(manifest.generated)) throw new Error('generated PDF assets changed since build')
  const served = await treeInventory(artifact, { internalLinks: true, exclude: new Set([MANIFEST]) })
  if (digest(served) !== digest(manifest.artifact)) throw new Error('served artifact changed since build')
  if (!served.files['server.js'] || !Object.keys(served.files).some(name => name.startsWith('.next/static/'))) throw new Error('incomplete served artifact')
  // Repeat bounded observations around the long artifact scan. This is a
  // freshness boundary, not a filesystem transaction against hostile writers.
  if (digest(await sourceInventory(source)) !== digest(sourceNow) || digest(await treeInventory(path.join(source, 'public/pdfjs'))) !== digest(generated) || digest(await treeInventory(artifact, { internalLinks: true, exclude: new Set([MANIFEST]) })) !== digest(served) || digest(await readJSON(path.join(source, RECEIPT))) !== digest(receipt) || digest(await readJSON(path.join(artifact, MANIFEST))) !== digest(manifest)) throw new Error('source/artifact/receipt changed during verification')
  await requireNoBuild(source)
  return { manifest_sha256: digest(manifest), build_id: manifest.build_id, source_sha256: manifest.input.sha256, artifact_sha256: manifest.artifact.sha256, generated_sha256: manifest.generated.sha256, claim: manifest.claim }
}

export async function buildArtifact({ source, outputParent = os.tmpdir(), inheritedEnv = process.env, prepare, compile, toolVersions = { node: process.version } }) {
  source = path.resolve(source)
  outputParent = path.resolve(outputParent)
  await noSymlinkPath(source)
  const lock = path.join(source, BUILD_LOCK)
  try { await mkdir(lock, { mode: 0o700 }) } catch (error) { if (error.code === 'EEXIST') throw new Error('frontend build already active; stale lock requires operator review'); throw error }
  const buildId = randomUUID()
  let artifact
  let home
  let receiptSafe = false
  try {
    await noSymlinkPath(path.join(source, '.next'))
    await mkdir(path.join(source, '.next'), { recursive: true })
    receiptSafe = true
    // Invalidate even if later validation/preparation/compilation fails. Never
    // alter an earlier immutable artifact which might still serve a preview.
    await atomicJSON(path.join(source, RECEIPT), { schema: SCHEMA, status: 'building', build_id: buildId })
    const input = await sourceInventory(source)
    await noSymlinkPath(outputParent)
    if (inside(source, outputParent)) throw new Error('artifact output must be outside source')
    home = await mkdtemp(path.join(os.tmpdir(), 'sw-frontend-build-home-'))
    const env = buildEnvironment(inheritedEnv, home)
    // next-env.d.ts is generated, not an uncontrolled build input.
    await noSymlinkPath(path.join(source, 'next-env.d.ts'))
    await rm(path.join(source, 'next-env.d.ts'), { force: true })
    await prepare(env)
    const generated = await treeInventory(path.join(source, 'public/pdfjs'))
    if (digest(await sourceInventory(source)) !== digest(input)) throw new Error('source inputs changed during preparation')
    await compile(env)
    if (digest(await sourceInventory(source)) !== digest(input)) throw new Error('source inputs changed during build')
    if (digest(await treeInventory(path.join(source, 'public/pdfjs'))) !== digest(generated)) throw new Error('generated PDF assets changed during build')
    const standalone = path.join(source, '.next/standalone')
    const staticDir = path.join(source, '.next/static')
    const standaloneInventory = await treeInventory(standalone, { internalLinks: true })
    const staticInventory = await treeInventory(staticDir)
    const publicInventory = await treeInventory(path.join(source, 'public'))
    artifact = await mkdtemp(path.join(outputParent, 'sw-frontend-artifact-'))
    for (const entry of await readdir(standalone)) await cp(path.join(standalone, entry), path.join(artifact, entry), { recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true })
    // A standalone tree with pre-populated copied assets is ambiguous/stale.
    for (const target of ['public', '.next/static']) {
      try { await lstat(path.join(artifact, target)); throw new Error('standalone unexpectedly contains copied serving assets') } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    await cp(staticDir, path.join(artifact, '.next/static'), { recursive: true, errorOnExist: true, force: false })
    await cp(path.join(source, 'public'), path.join(artifact, 'public'), { recursive: true, errorOnExist: true, force: false })
    const served = await treeInventory(artifact, { internalLinks: true })
    const expectedFiles = { ...standaloneInventory.files, ...Object.fromEntries(Object.entries(staticInventory.files).map(([name, record]) => [`.next/static/${name}`, record])), ...Object.fromEntries(Object.entries(publicInventory.files).map(([name, record]) => [`public/${name}`, record])) }
    if (digest(served.files) !== digest(expectedFiles)) throw new Error('build outputs changed during packaging')
    if (!served.files['server.js'] || !Object.keys(served.files).some(name => name.startsWith('.next/static/'))) throw new Error('incomplete served artifact')
    if (digest(await sourceInventory(source)) !== digest(input) || digest(await treeInventory(path.join(source, 'public/pdfjs'))) !== digest(generated)) throw new Error('source inputs changed during packaging')
    const manifest = { schema: SCHEMA, build_id: buildId, created_at: new Date().toISOString(), claim: 'source-artifact-association-not-reproducibility', command: 'npm run build', profile: 'controlled-production-no-public-env-overrides', tools: toolVersions, input, generated, artifact: served }
    await atomicJSON(path.join(artifact, MANIFEST), manifest)
    await atomicJSON(path.join(source, RECEIPT), { schema: SCHEMA, status: 'passed', build_id: buildId, manifest_sha256: digest(manifest) })
    return { artifact, manifest }
  } catch (error) {
    if (receiptSafe) {
      await noSymlinkPath(path.join(source, '.next'))
      await mkdir(path.join(source, '.next'), { recursive: true })
      await atomicJSON(path.join(source, RECEIPT), { schema: SCHEMA, status: 'failed', build_id: buildId })
    }
    if (artifact) await rm(path.join(artifact, MANIFEST), { force: true })
    throw error
  } finally {
    try { if (home) await rm(home, { recursive: true, force: true }) } finally { await rm(lock, { recursive: true }) }
  }
}

export async function runBuildCommand(command, args, source, env) {
  // Do not print/store child output: transport diagnostics may contain proxy auth.
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: source, env, stdio: 'ignore' })
    child.on('error', () => reject(new Error('build tool could not start')))
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`build tool failed (exit ${code}); no potentially sensitive transport output recorded`)))
  })
}
