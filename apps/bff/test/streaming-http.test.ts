import { afterEach, describe, expect, it } from 'vitest'
import { request as httpRequest, createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { createHttpAdapter } from '../src/http-adapter.js'
import { config } from './fixtures.js'
import { closeFixtures, collect, deferred, listen, sendJson, sha256, startUpstream } from './fixtures/upstream.js'

afterEach(closeFixtures)
describe.each(['legacy_password', 'device_sessions'] as const)('incremental native HTTP %s', mode => {
  it('delivers split UTF-8 and split JSON before completion without rewriting any SSE bytes', async () => {
    const wire = Buffer.from('event: stage\ndata: {"message":"资料","future":{"a":1}}\n\nevent: final\ndata: {"status":"succeeded"}\n\n')
    const unicode = wire.indexOf(Buffer.from('资'))
    const breaks = [unicode + 1, wire.indexOf(Buffer.from('future')) + 4]
    const releaseSecond = deferred(), releaseLast = deferred()
    let finished = false
    const run = await startUpstream(mode, { respond: async (req, res) => {
      await collect(req)
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-private': 'never', 'set-cookie': ['a=never', 'b=never'] })
      res.write(wire.subarray(0, breaks[0])); await releaseSecond.promise
      res.write(wire.subarray(breaks[0], breaks[1])); await releaseLast.promise
      finished = true; res.end(wire.subarray(breaks[1]))
    } })
    await run.activate()
    const response = await fetch(run.bff + '/api/search/ask', { method: 'POST', headers: run.headers, body: '{}' })
    const reader = response.body!.getReader(), chunks: Buffer[] = [], decoder = new TextDecoder('utf-8', { fatal: true })
    let text = ''
    async function through(length: number) {
      while (Buffer.concat(chunks).length < length) {
        const next = await reader.read(); expect(next.done).toBe(false)
        chunks.push(Buffer.from(next.value!)); text += decoder.decode(next.value, { stream: true })
      }
    }
    await through(breaks[0]!)
    run.events.push('client:first-incomplete-utf8'); expect(finished).toBe(false); expect(text).not.toContain('资')
    releaseSecond.resolve(); await through(breaks[1]!)
    run.events.push('client:partial-json'); expect(finished).toBe(false); expect(text).toContain('资料')
    releaseLast.resolve()
    while (true) { const next = await reader.read(); if (next.done) break; chunks.push(Buffer.from(next.value)); text += decoder.decode(next.value, { stream: true }) }
    text += decoder.decode()
    expect(Buffer.concat(chunks)).toEqual(wire); expect(text).toBe(wire.toString())
    expect(sha256(Buffer.concat(chunks))).toBe('f7df383fb76564a1081a9006ecf83ded32e01b33b6b637f8574bc08c15c8def2')
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform')
    expect(response.headers.get('x-accel-buffering')).toBe('no'); expect(response.headers.get('content-length')).toBeNull()
    expect(response.headers.get('set-cookie')).toBeNull(); expect(response.headers.get('x-private')).toBeNull()
    console.info('SSE fixture', mode, run.events.filter(x => x.startsWith('client:')), sha256(wire))
  })

  it('forwards a chunked binary multipart body before EOF with the original boundary and file hash', async () => {
    const file = Buffer.from(Array.from({ length: 1_048_593 }, (_, i) => i % 256))
    const boundary = 'synthetic-boundary-20261108'
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.zip"\r\nContent-Type: application/zip\r\n\r\n`)
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`), body = Buffer.concat([head, file, tail])
    const firstArrived = deferred(); let received = Buffer.alloc(0)
    const run = await startUpstream(mode, { respond: async (req, res, entry) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) { chunks.push(Buffer.from(chunk)); firstArrived.resolve() }
      received = Buffer.concat(chunks); entry.bytes = received; sendJson(res, { imported: true })
    } })
    await run.activate()
    let ended = false
    const result = new Promise<number>((resolve, reject) => {
      const request = httpRequest(run.bff + '/api/personal/imports/portable', { method: 'POST', headers: { ...run.headers, 'content-type': `multipart/form-data; boundary=${boundary}` } }, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode!))
      }); request.on('error', reject)
      request.write(body.subarray(0, 65536))
      void firstArrived.promise.then(() => { expect(ended).toBe(false); run.events.push('api:upload-before-client-eof'); ended = true; request.end(body.subarray(65536)) })
    })
    expect(await result).toBe(200); expect(received).toEqual(body)
    expect(sha256(received.subarray(head.length, head.length + file.length))).toBe('198fe22858bf90dd34cba065bf3e3d4680918f930e94ce51807b9b3055f2eb1e')
    expect(sha256(received)).toBe('3033dc9ebd2843ec3c1dd72ee1f6cd2ccd8246012b5cbad1f7df786fc521f44c')
    expect(run.ingress.at(-1)!.cookie).toContain('CF_Authorization=synthetic-ingress')
    const entry = run.captured.find(x => x.path === '/api/personal/imports/portable')!
    expect(entry.headers['content-type']).toBe(`multipart/form-data; boundary=${boundary}`)
    expect(entry.headers['transfer-encoding']).toBe('chunked'); expect(entry.headers.cookie).toBeUndefined()
    expect(run.reads.at(-1)!.bytes).toBe(body.length); expect(run.reads.at(-1)!.pulls).toBeGreaterThan(1)
    console.info('multipart fixture', mode, file.length, sha256(file), sha256(body), run.events.at(-2))
  })

  it('cancels an unfinished upstream SSE once the downstream reader is canceled without replay', async () => {
    const closed = deferred(); let writes = 0
    const run = await startUpstream(mode, { respond: async (req, res) => {
      await collect(req); res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.once('close', () => { run.events.push('api:stream-closed'); closed.resolve() })
      writes++; res.write('data: {"status":"running"}\n\n')
    } })
    await run.activate()
    const response = await fetch(run.bff + '/api/search/ask', { method: 'POST', headers: run.headers, body: '{}' })
    const reader = response.body!.getReader(); expect((await reader.read()).done).toBe(false)
    await reader.cancel(); await closed.promise
    expect(writes).toBe(1); expect(run.captured.filter(x => x.path === '/api/search/ask')).toHaveLength(1)
  })

  it('cancels a partially forwarded upload when the downstream disconnects without reading a successor body', async () => {
    const first = deferred(), closed = deferred()
    let consumed = 0
    const run = await startUpstream(mode, { respond: (req, _res) => {
      req.on('data', bytes => { consumed += bytes.length; first.resolve() })
      req.once('aborted', () => closed.resolve())
    } }); await run.activate()
    const request = httpRequest(run.bff + '/api/personal/imports/portable', { method: 'POST', headers: { ...run.headers, 'content-type': 'multipart/form-data; boundary=synthetic' } })
    request.on('error', () => {}); request.write(Buffer.alloc(32768, 7))
    await first.promise; request.destroy(); await closed.promise
    const after = consumed; await new Promise<void>(resolve => setImmediate(resolve))
    expect(consumed).toBe(after); expect(consumed).toBe(32768)
    expect(run.captured.filter(x => x.path === '/api/personal/imports/portable')).toHaveLength(1)
  })

  it('retains upload identity after upstream receipt loss and never resubmits its body', async () => {
    const body = Buffer.from('--synthetic\r\nContent-Disposition: form-data; name="idempotency_key"\r\n\r\noriginal-operation-fixture\r\n--synthetic--\r\n')
    const run = await startUpstream(mode, { respond: async (req, res, entry) => { entry.bytes = await collect(req); res.destroy() } })
    await run.activate()
    const response = await fetch(run.bff + '/api/personal/imports/portable', { method: 'POST', headers: { ...run.headers, 'content-type': 'multipart/form-data; boundary=synthetic' }, body })
    expect(response.status).toBe(502); expect(await response.text()).toContain('UPSTREAM_UNAVAILABLE')
    const calls = run.captured.filter(x => x.path === '/api/personal/imports/portable')
    expect(calls).toHaveLength(1); expect(calls[0]!.bytes).toEqual(body)
  })

  it('streams decompressed download bytes while omitting stale compressed length and encoding', async () => {
    const bytes = Buffer.from('synthetic decoded bytes\n'.repeat(2048)), compressed = gzipSync(bytes)
    const run = await startUpstream(mode, { respond: (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip', 'content-length': String(compressed.length) }); res.end(compressed)
    } }); await run.activate()
    const response = await fetch(run.bff + '/api/sources/source%3Aone/download', { headers: run.headers })
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    expect(response.headers.get('content-length')).toBeNull(); expect(response.headers.get('content-encoding')).toBeNull()
    expect(run.captured.at(-1)!.headers['accept-encoding']).toBe('identity')
  })

  it.each([200, 206, 416])('preserves binary download %s bytes and reviewed headers without ingress Cookie custody', async status => {
    const bytes = status === 416 ? Buffer.alloc(0) : Buffer.from(Array.from({ length: 131077 }, (_, i) => i % 256))
    const run = await startUpstream(mode, { respond: (_req, res) => {
      res.writeHead(status, { 'content-type': status === 416 ? 'text/plain' : 'application/pdf', 'content-length': String(bytes.length),
        'content-range': status === 416 ? 'bytes */131077' : `bytes 0-${bytes.length - 1}/${bytes.length}`, 'accept-ranges': 'bytes',
        'content-disposition': "attachment; filename*=UTF-8''synthetic%20%E8%B5%84%E6%96%99.pdf", etag: '"fixture"',
        'last-modified': 'Wed, 21 Oct 2026 00:00:00 GMT', vary: 'Accept-Encoding, Accept', 'set-cookie': ['one=never', 'two=never'],
        'access-control-allow-origin': '*', 'x-private': 'never' }); res.end(bytes)
    } })
    await run.activate()
    const response = await fetch(run.bff + '/api/personal/source-versions/version%3Aone/download', { headers: { ...run.headers, range: 'bytes=0-', 'if-range': '"fixture"' } })
    expect(response.status).toBe(status); expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    expect(response.headers.get('content-length')).toBe(String(bytes.length)); expect(response.headers.get('etag')).toBe('"fixture"')
    expect(response.headers.get('content-disposition')).toContain('filename*=UTF-8'); expect(response.headers.get('vary')).toBe('Accept-Encoding, Accept')
    for (const header of ['set-cookie', 'access-control-allow-origin', 'x-private']) expect(response.headers.get(header)).toBeNull()
    const entry = run.captured.at(-1)!; expect(entry.headers.range).toBe('bytes=0-'); expect(entry.headers['if-range']).toBe('"fixture"')
    for (const entry of run.captured) expect(entry.headers.cookie).toBeUndefined()
  })
})

it('does not pull a second response chunk while the native response is waiting for drain', async () => {
  let pulls = 0, writes = 0
  const stalled = deferred(), release = deferred(), canceled = deferred()
  const adapter = createHttpAdapter(async () => new Response(new ReadableStream<Uint8Array>({
    pull(c) { pulls++; c.enqueue(Buffer.alloc(1024)); }, cancel() { canceled.resolve() },
  }, { highWaterMark: 0 })), config())
  const base = await listen(createServer((req, res) => {
    const write = res.write.bind(res)
    res.write = ((chunk: Uint8Array) => { writes++; write(chunk); stalled.resolve(); return false }) as typeof res.write
    void release.promise.then(() => res.emit('drain'))
    adapter(req, res)
  }))
  const controller = new AbortController()
  const response = await fetch(base + '/api/notebooks', { signal: controller.signal })
  await stalled.promise
  // Event-loop checkpoint, not an elapsed-time inference about socket buffers.
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(writes).toBe(1); expect(pulls).toBe(1)
  controller.abort(); await canceled.promise; release.resolve(); await response.body?.cancel().catch(() => {})
})
