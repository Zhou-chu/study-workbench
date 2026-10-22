import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InternalAxiosRequestConfig } from 'axios'
import apiClient from './client'
import { notesApi } from './notes'
import { evidenceApi } from './evidence'
import { workbenchApi } from './workbench'
import { notebooklmApi } from './notebooklm'
import type { TurnRequest, WorkbenchSelection } from '@/lib/types/personal'

vi.mock('@/lib/config', () => ({ getApiUrl: async () => 'http://127.0.0.1:5055', getConfig: async () => ({ authMode: 'legacy_password', apiUrl: 'http://127.0.0.1:5055' }) }))
vi.mock('@/lib/auth-token', () => ({ getAuthToken: () => 'unit-test-token-not-a-credential' }))

// Keep the real shared Axios client, interceptors and JSON/FormData transforms.
// Replace only the final transport: these tests cannot make network requests.
const originalAdapter = apiClient.defaults.adapter
const requests: InternalAxiosRequestConfig[] = []
let responseData: unknown
const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
  requests.push(config)
  return { data: responseData, status: 200, statusText: 'OK', headers: {}, config }
})
const notebook = 'notebook:course/一'
const notebookPath = 'notebook%3Acourse%2F%E4%B8%80'
const remote = 'remote/book #1'
const remotePath = 'remote%2Fbook%20%231'
const selection: WorkbenchSelection = { engine: 'independent', selection_origin: 'local', source_version_ids: ['sv:old/一'], remote_source_ids: [], reading: { source_version_id: 'sv:old/一', page_index: 7, evidence_id: 'evidence:old' } }
const requestBody = (index = 0) => JSON.parse(requests[index].data)

beforeEach(() => {
  requests.length = 0
  responseData = { marker: 'server response' }
  adapter.mockClear()
  apiClient.defaults.adapter = adapter
})
afterEach(() => { apiClient.defaults.adapter = originalAdapter })

describe('evidence transport contracts', () => {
  it('requests a retained extraction by evidence ID, with encoded immutable version and abort signal', async () => {
    const controller = new AbortController()
    responseData = { version: { source_version_id: 'sv:old/一' }, extraction: { extraction_id: 'ex_old' }, evidence: [] }
    const result = await evidenceApi.version('sv:old/一', controller.signal, 'evidence:old/一')
    expect(requests[0]).toMatchObject({ method: 'get', url: '/personal/source-versions/sv%3Aold%2F%E4%B8%80', signal: controller.signal, params: { evidence_id: 'evidence:old/一' } })
    expect(result).toEqual(responseData)
  })
  it('downloads protected original bytes through the authenticated client, without a public URL', async () => {
    const controller = new AbortController()
    const blob = new Blob(['%PDF fixture'], { type: 'application/pdf' })
    responseData = blob
    expect(await evidenceApi.download('sv:old/一', controller.signal)).toBe(blob)
    expect(requests[0]).toMatchObject({ method: 'get', baseURL: 'http://127.0.0.1:5055/api', url: '/personal/source-versions/sv%3Aold%2F%E4%B8%80/download', responseType: 'blob', signal: controller.signal })
    expect(requests[0].headers.get('Authorization')).toBe('Bearer unit-test-token-not-a-credential')
  })
  it('forwards only explicitly selected search versions and preserves unverified archive results', async () => {
    responseData = { hits: [{ evidence_id: 'ev_archive', reference_validity: 'unverified' }], retrieval_method: 'lexical' }
    const result = await evidenceApi.search('原文 😀', ['sv_old', 'sv_archive'])
    expect(requests[0].url).toBe('/personal/search')
    expect(requestBody()).toEqual({ query: '原文 😀', source_version_ids: ['sv_old', 'sv_archive'] })
    expect(result.hits[0].reference_validity).toBe('unverified')
  })
  it('does not expand an empty search scope and encodes source/evidence lookup IDs', async () => {
    await evidenceApi.search('evidence', [])
    await evidenceApi.versions('source:one/two')
    await evidenceApi.evidence('ev:one/two')
    expect(requestBody().source_version_ids).toEqual([])
    expect(requests.slice(1).map(request => request.url)).toEqual(['/personal/sources/source%3Aone%2Ftwo/versions', '/personal/evidence/ev%3Aone%2Ftwo'])
  })
})

describe('workbench transport contracts', () => {
  it('uses the same encoded notebook for loading and persisting the exact historical selection', async () => {
    await workbenchApi.workspace(notebook)
    await workbenchApi.saveSelection(notebook, selection)
    expect(requests.map(request => [request.method, request.url])).toEqual([['get', `/personal/notebooks/${notebookPath}/workspace`], ['patch', `/personal/notebooks/${notebookPath}/selection`]])
    expect(requestBody(1)).toEqual(selection)
  })
  it.each([undefined, 'source:existing/一'])('uploads multipart bytes with stable idempotency and optional source %s', async sourceId => {
    const file = new File(['😀 notes'], 'lecture 一.txt', { type: 'text/plain' })
    responseData = { source_id: 'source:existing/一', source_version_id: 'sv_new', job_id: 'job1' }
    expect(await workbenchApi.upload(notebook, file, 'upload-fixed-key', sourceId)).toEqual(responseData)
    const request = requests[0]
    expect(request.url).toBe(`/personal/notebooks/${notebookPath}/sources/upload`)
    expect(request.data).toBeInstanceOf(FormData)
    const form = request.data as FormData
    expect(form.get('file')).toBe(file)
    expect(form.get('title')).toBe('lecture 一.txt')
    expect(form.get('idempotency_key')).toBe('upload-fixed-key')
    expect(form.get('source_id')).toBe(sourceId ?? null)
    expect(request.headers.get('Content-Type')).not.toContain('application/json')
    expect(request.headers.get('Authorization')).toBe('Bearer unit-test-token-not-a-credential')
  })
  it('forwards exact outline scope and idempotency, then polls only the encoded session', async () => {
    const body: TurnRequest = { ...selection, engine: 'independent', notebook_id: notebook, task: 'outline', message: 'Outline these sources', idempotency_key: 'turn-fixed-key' }
    await workbenchApi.turn('v1_notebook:one/two', body)
    await workbenchApi.turns('v1_notebook:one/two')
    expect(requests.map(request => [request.method, request.url])).toEqual([['post', '/personal/chats/v1_notebook%3Aone%2Ftwo/turns'], ['get', '/personal/chats/v1_notebook%3Aone%2Ftwo/turns']])
    expect(requestBody()).toEqual(body)
  })
  it('saves and edits the original citation/scope snapshot rather than rewriting it', async () => {
    const note = { title: 'Saved answer', content: '**Original answer**', citations: [{ citation_id: 'C1', kind: 'local_evidence' as const, source_version_id: 'sv_old', evidence_id: 'ev_old', quote: 'original', source_title: 'Old PDF', reference_validity: 'unverified' }], scope_snapshot: { source_version_ids: ['sv_old'] } }
    await workbenchApi.saveNote(notebook, note)
    await workbenchApi.updateNote(notebook, 'note:one/two', { ...note, expected_revision: 7 })
    expect(requests.map(request => [request.method, request.url])).toEqual([['post', `/personal/notebooks/${notebookPath}/notes`], ['patch', `/personal/notebooks/${notebookPath}/notes/note%3Aone%2Ftwo`]])
    expect(requestBody()).toEqual(note)
    expect(requestBody(1)).toEqual({ ...note, expected_revision: 7 })
    expect(requestBody()).not.toHaveProperty('expected_revision')
  })
  it('does not cancel a job just by polling it', async () => {
    await workbenchApi.job('job:one/two')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'get', url: '/personal/jobs/job%3Aone%2Ftwo' })
    await workbenchApi.cancelJob('job:one/two')
    expect(requests[1]).toMatchObject({ method: 'post', url: '/personal/jobs/job%3Aone%2Ftwo/cancel' })
  })
})

describe('NotebookLM explicit-action transport contracts', () => {
  it('keeps connection reads, initial sign-in and reconnect as distinct explicit operations', async () => {
    await notebooklmApi.status()
    await notebooklmApi.capabilities()
    await notebooklmApi.flow('flow:one/two')
    expect(requests.every(request => request.method === 'get')).toBe(true)
    await notebooklmApi.connect()
    await notebooklmApi.connect(true)
    await notebooklmApi.disconnect()
    expect(requests.map(request => [request.method, request.url])).toEqual([
      ['get', '/personal/connections/notebooklm'], ['get', '/personal/notebooklm/capabilities'], ['get', '/personal/connections/notebooklm/connect/flow%3Aone%2Ftwo'],
      ['post', '/personal/connections/notebooklm/connect'], ['post', '/personal/connections/notebooklm/reconnect'], ['delete', '/personal/connections/notebooklm'],
    ])
  })
  it('retains pagination cursors and encoded remote IDs without automatically enumerating more pages', async () => {
    responseData = { items: [], next_cursor: 'next/page', listing_complete: false }
    const page = await notebooklmApi.notebooks('first/page')
    expect(page).toEqual(responseData)
    expect(requests).toHaveLength(1)
    expect(requests[0].params).toEqual({ cursor: 'first/page' })
    await notebooklmApi.sources(remote, 'source/page')
    await notebooklmApi.artifacts(remote)
    expect(requests[1]).toMatchObject({ method: 'get', url: `/personal/notebooklm/notebooks/${remotePath}/sources`, params: { cursor: 'source/page' } })
    expect(requests[2].url).toBe(`/personal/notebooklm/notebooks/${remotePath}/artifacts`)
  })
  it('keeps linking, exact original association and remote creation separate with explicit bodies', async () => {
    await notebooklmApi.link(notebook, remote)
    const association = { remote_notebook_id: remote, remote_source_id: 'remote/source', source_version_id: 'sv_old', user_confirmed: true as const }
    await notebooklmApi.associateSource(notebook, association)
    await notebooklmApi.createNotebook(notebook, 'Course title', 'create-fixed-key')
    expect(requests.map(request => request.url)).toEqual([`/personal/notebooks/${notebookPath}/notebooklm-link`, `/personal/notebooks/${notebookPath}/notebooklm-source-link`, '/personal/notebooklm/notebooks'])
    expect(requestBody()).toEqual({ remote_notebook_id: remote })
    expect(requestBody(1)).toEqual(association)
    expect(requestBody(2)).toEqual({ notebook_id: notebook, title: 'Course title', idempotency_key: 'create-fixed-key' })
  })
  it('sends only the confirmed sync/import/audio scopes and original idempotency keys', async () => {
    const sync = { remote_notebook_id: remote, source_version_ids: ['sv_old', 'sv_older'], idempotency_key: 'sync-fixed-key' }
    const imported = { remote_notebook_id: remote, remote_source_ids: ['source_selected'], include_text: true, idempotency_key: 'import-fixed-key' }
    const audio = { remote_notebook_id: remote, remote_source_ids: ['source_selected'], source_version_ids: [], language: 'zh', idempotency_key: 'audio-fixed-key' }
    await notebooklmApi.sync(notebook, sync)
    await notebooklmApi.importSources(notebook, imported)
    await notebooklmApi.audio(notebook, audio)
    expect(requests.map(request => request.url)).toEqual([`/personal/notebooks/${notebookPath}/sync/notebooklm`, `/personal/notebooks/${notebookPath}/imports/notebooklm`, `/personal/notebooks/${notebookPath}/artifacts/audio`])
    expect(requests.map((_, index) => requestBody(index))).toEqual([sync, imported, audio])
  })
  it('submits an explicit artifact download with its original target and idempotency', async () => {
    const body = { notebook_id: notebook, remote_notebook_id: remote, idempotency_key: 'download-fixed-key' }
    responseData = { job_id: 'job_download', state: 'queued' }
    expect(await notebooklmApi.downloadArtifact('artifact:one/two', body)).toEqual(responseData)
    expect(requests[0].url).toBe('/personal/notebooklm/artifacts/artifact%3Aone%2Ftwo/download')
    expect(requestBody()).toEqual(body)
  })
  it('propagates uncertain submission once and does not replay the write or replace its idempotency key', async () => {
    const body = { remote_notebook_id: remote, source_version_ids: ['sv_old'], idempotency_key: 'keep-this-key' }
    adapter.mockRejectedValueOnce(new Error('submission_unknown'))
    await expect(notebooklmApi.sync(notebook, body)).rejects.toThrow('submission_unknown')
    expect(adapter).toHaveBeenCalledTimes(1)
    expect(JSON.parse(adapter.mock.calls[0][0].data)).toEqual(body)
    // A second request exists only because the caller explicitly invokes it.
    await notebooklmApi.sync(notebook, body)
    expect(adapter).toHaveBeenCalledTimes(2)
    expect(requestBody()).toEqual(body)
  })
})

it('submits maintenance with encoded version, exact archived extraction and idempotency key', async () => {
  const controller = new AbortController()
  await evidenceApi.revalidate('sv:old/一', 'ex_old', 'verify-key', controller.signal)
  await evidenceApi.reparse('sv:old/一', 'parse-key', controller.signal)
  expect(requests.map(request => request.url)).toEqual(['/personal/source-versions/sv%3Aold%2F%E4%B8%80/revalidate', '/personal/source-versions/sv%3Aold%2F%E4%B8%80/reparse'])
  expect(requestBody(0)).toEqual({ extraction_id: 'ex_old', idempotency_key: 'verify-key' })
  expect(requestBody(1)).toEqual({ idempotency_key: 'parse-key' })
  expect(requests.every(request => request.signal === controller.signal && request.method === 'post')).toBe(true)
  expect(requests[0].headers.get('Authorization')).toBe('Bearer unit-test-token-not-a-credential')
})

it('legacy PUT sends its captured predecessor and create omits it', async () => {
  await notesApi.update('note:a', { title: 'draft', content: 'body', expected_revision: 9 })
  await notesApi.create({ title: 'new', content: 'body', notebook_id: 'notebook:1' })
  expect(requestBody()).toEqual({ title: 'draft', content: 'body', expected_revision: 9 })
  expect(requests[0].method).toBe('put')
  expect(requestBody(1)).not.toHaveProperty('expected_revision')
})
