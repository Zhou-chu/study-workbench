import { expect, it } from 'vitest'
import { createEditor, reduceEditor } from './editor.js'
const draft = { title: 'Title', content: 'Original', citations: [] }
it('holds note creates after unknown and does not manufacture server idempotency', () => {
  let editor = createEditor('notebook:one', draft)
  editor = reduceEditor(editor, { type: 'begin-save', operationId: 'local-only' })
  expect(editor.pending?.payload).toEqual(draft); expect(editor.pending?.payload).not.toHaveProperty('idempotency_key')
  expect(reduceEditor(editor, { type: 'begin-save', operationId: 'duplicate' })).toBe(editor)
  editor = reduceEditor(editor, { type: 'save-unknown', operationId: 'local-only' })
  expect(editor.saveResult).toBe('unknown')
  expect(reduceEditor(editor, { type: 'begin-save', operationId: 'new-key' })).toBe(editor)
  expect(editor.content).toBe('Original')
})
it('updates with the captured revision and late success preserves newer text', () => {
  let editor = createEditor('notebook:one', draft, { id: 'note:one', revision: 4 })
  editor = reduceEditor(editor, { type: 'edit', content: 'Sending' })
  editor = reduceEditor(editor, { type: 'begin-save', operationId: 'save-1' })
  expect(editor.pending?.payload).toMatchObject({ expected_revision: 4, content: 'Sending' })
  editor = reduceEditor(editor, { type: 'edit', content: 'Newer' })
  editor = reduceEditor(editor, { type: 'save-success', operationId: 'save-1', note: { id: 'note:one', revision: 5, ...draft, content: 'Sending' } })
  expect(editor.content).toBe('Newer'); expect(editor.baseRevision).toBe(5); expect(editor.dirty).toBe(true)
  expect(reduceEditor(editor, { type: 'save-success', operationId: 'save-old', note: { id: 'other', revision: 9 } })).toBe(editor)
})
it.each([409, 428])('preserves draft and base on HTTP %s', status => {
  let editor = createEditor('n', draft, { id: 'note', revision: 2 })
  editor = reduceEditor(editor, { type: 'begin-save', operationId: 'save' })
  editor = reduceEditor(editor, { type: 'save-conflict', operationId: 'save', status })
  expect(editor.saveResult).toBe('conflict'); expect(editor.baseRevision).toBe(2); expect(editor.content).toBe('Original')
  expect(reduceEditor(editor, { type: 'begin-save', operationId: 'again' })).toBe(editor)
})

it('emits only existing note DTO fields, never caller extensions or a local UUID', () => {
  const input = { ...draft,idempotency_key:'not-server-supported',unexpected:'excluded' }
  const editor = reduceEditor(createEditor('n',input),{ type:'begin-save',operationId:'local-only' })
  expect(editor.pending?.payload).toEqual(draft)
})

it.each(['save-unknown', 'save-rejected', 'save-conflict'] as const)('cannot downgrade %s using a later not-sent event', type => {
  const started = reduceEditor(createEditor('notebook:one', draft), { type: 'begin-save', operationId: 'original-create' })
  const uncertain = reduceEditor(started, { type, operationId: 'original-create', status: 409 })
  const late = reduceEditor(uncertain, { type: 'save-not-sent', operationId: 'original-create' })
  expect(late).toBe(uncertain); expect(late.pending?.operationId).toBe('original-create')
  expect(reduceEditor(late, { type: 'begin-save', operationId: 'new-key' })).toBe(uncertain)
})
it('allows initial local not-sent evidence to release only the still-saving attempt', () => {
  const started = reduceEditor(createEditor('n', draft), { type: 'begin-save', operationId: 'not-sent' })
  const notSent = reduceEditor(started, { type: 'save-not-sent', operationId: 'not-sent' })
  expect(notSent.saveResult).toBe('idle'); expect(notSent.pending).toBeNull()
  expect(reduceEditor(notSent, { type: 'begin-save', operationId: 'next' }).pending?.operationId).toBe('next')
})
