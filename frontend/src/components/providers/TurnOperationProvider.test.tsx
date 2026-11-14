import { readFileSync } from 'node:fs'
import React, { StrictMode, useLayoutEffect } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionCoordinator } from '@/lib/auth/session-coordinator'
import { invalidateTurnContext, publishTurnTarget, readTurnContext, suspendTurnTarget, type TurnContext } from '@/lib/workbench/turn-context'
import type { AttemptToken, TurnRegistry, ValidatedTurnCapture } from '@/lib/workbench/turn-operations'
import { TurnOperationProvider, useTurnOperationRegistry, useTurnOperationSnapshot } from './TurnOperationProvider'

const target = { mode: 'legacy_password' as const, apiBase: 'https://fixture.example/api', protocol: null }
function input(context: TurnContext = readTurnContext()!): ValidatedTurnCapture {
  return { sessionId: 'chat:one', context, owner: { mountId: 'mount:one' }, request: { notebook_id: 'notebook:one', task: 'question', engine: 'independent', selection_origin: 'local', source_version_ids: ['version:one'], remote_source_ids: [], message: 'Private question' } }
}
let registry: TurnRegistry
function Consumer() {
  registry = useTurnOperationRegistry()
  const operation = useTurnOperationSnapshot('notebook:one')
  return <div><output data-testid="operation">{operation?.capture.operationId ?? 'none'}</output><button onClick={() => registry.admit(input())}>Admit</button></div>
}
function admit(): AttemptToken {
  let result: ReturnType<TurnRegistry['admit']> | undefined
  act(() => { result = registry.admit(input()) })
  if (!result?.ok) throw new Error('Admission rejected')
  return result.token
}
beforeEach(() => { invalidateTurnContext(); publishTurnTarget(target, true); sessionCoordinator.setPhase('authenticated'); vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('root document turn owner', () => {
  it('is nested inside I18nProvider and outside ConnectionGuard in the actual root layout', () => {
    const layout = readFileSync('src/app/layout.tsx', 'utf8')
    expect(layout).toMatch(/<I18nProvider>\s*<TurnOperationProvider>\s*<ConnectionGuard>/)
    expect(layout).toMatch(/<\/ConnectionGuard>\s*<\/TurnOperationProvider>\s*<\/I18nProvider>/)
  })
  it('rejects structurally malformed captured context without throwing', () => {
    render(<TurnOperationProvider><Consumer /></TurnOperationProvider>)
    const value = { ...input(), context: { ...readTurnContext()!, target: null } } as unknown as ValidatedTurnCapture
    expect(registry.admit(value)).toEqual({ ok: false, reason: 'invalid' })
  })
  it('retains a capture across route consumer unmount/remount without automatic work', () => {
    const view = render(<TurnOperationProvider><Consumer /></TurnOperationProvider>)
    fireEvent.click(screen.getByText('Admit')); const operationId = screen.getByTestId('operation').textContent
    view.rerender(<TurnOperationProvider><div>Other route</div></TurnOperationProvider>)
    expect(registry.getSnapshot('notebook:one')?.capture.operationId).toBe(operationId)
    view.rerender(<TurnOperationProvider><Consumer /></TurnOperationProvider>)
    expect(screen.getByTestId('operation')).toHaveTextContent(operationId!)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('root replacement clears payload references and retires old facade closures', () => {
    const view = render(<TurnOperationProvider><Consumer /></TurnOperationProvider>); const token = admit(); const old = registry
    view.unmount(); expect(old.getSnapshot(token.notebookId)).toBeNull()
    expect(old.admit(input())).toEqual({ ok: false, reason: 'unavailable' })
    render(<TurnOperationProvider><Consumer /></TurnOperationProvider>)
    expect(registry).not.toBe(old); expect(screen.getByTestId('operation')).toHaveTextContent('none')
    old.settlePost(token, { kind: 'bound', jobId: 'late', turnId: 'late', state: 'succeeded', dispatchUnknown: false })
    expect(registry.getSnapshot(token.notebookId)).toBeNull(); expect(old.getSnapshot(token.notebookId)).toBeNull()
  })
  it('epoch invalidation synchronously notifies empty snapshots and rejects a late promise', async () => {
    render(<TurnOperationProvider><Consumer /></TurnOperationProvider>); const token = admit()
    const observations: unknown[] = []; const stop = registry.subscribe(() => observations.push(registry.getSnapshot(token.notebookId)))
    let finish!: () => void
    const promise = new Promise<void>(resolve => { finish = resolve }).then(() => registry.settlePost(token, { kind: 'bound', jobId: 'late', turnId: 'late', state: 'queued', dispatchUnknown: false }))
    act(() => { invalidateTurnContext(); expect(observations).toEqual([null]); expect(registry.getSnapshot(token.notebookId)).toBeNull() })
    await act(async () => { finish(); await promise })
    expect(screen.getByTestId('operation')).toHaveTextContent('none'); stop()
  })
  it('retains same-target capture through readiness suspension/auth recovery and allows only safe settlement', () => {
    render(<TurnOperationProvider><Consumer /></TurnOperationProvider>); const token = admit(); const capture = registry.getSnapshot(token.notebookId)!.capture
    act(() => { suspendTurnTarget(); sessionCoordinator.setPhase('refresh-needed') })
    act(() => registry.settlePost(token, { kind: 'bound', jobId: 'parent', turnId: 'turn', state: 'queued', dispatchUnknown: false }))
    expect(registry.getSnapshot(token.notebookId)).toMatchObject({ capture, receipt: { jobId: 'parent', turnId: 'turn' }, busy: null })
    expect(registry.beginCheck(token.operationId)).toBeNull(); expect(registry.beginRetry(token.operationId)).toBeNull()
    expect(registry.admit({ ...input(), request: { ...input().request, notebook_id: 'other' } })).toEqual({ ok: false, reason: 'unavailable' })
    act(() => { publishTurnTarget(target, true); sessionCoordinator.setPhase('authenticated') })
    let check: AttemptToken | null = null; act(() => { check = registry.beginCheck(token.operationId) })
    expect(check).not.toBeNull(); expect(registry.getSnapshot(token.notebookId)!.capture).toBe(capture)
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['bootstrapping', 'pending', 'refresh-needed', 'reauth-required', 'unavailable', 'anonymous'] as const)('requires authenticated dispatch phase, not %s, for admission/retry/check', phase => {
    render(<TurnOperationProvider><Consumer /></TurnOperationProvider>); const token = admit()
    act(() => registry.settlePost(token, { kind: 'unknown', reason: 'transport' })); sessionCoordinator.setPhase(phase)
    expect(registry.beginRetry(token.operationId)).toBeNull(); expect(registry.beginCheck(token.operationId)).toBeNull()
    expect(registry.admit(input())).toEqual({ ok: false, reason: 'unavailable' })
    expect(registry.getSnapshot(token.notebookId)).not.toBeNull()
  })
  it('same-target readiness loss does not discard a pending read settlement', () => {
    render(<TurnOperationProvider><Consumer /></TurnOperationProvider>); const token = admit()
    act(() => registry.settlePost(token, { kind: 'unknown', reason: 'transport' }))
    let check!: AttemptToken; act(() => { check = registry.beginCheck(token.operationId)!; suspendTurnTarget(); sessionCoordinator.setPhase('refresh-needed') })
    act(() => registry.settleCheck(check, { kind: 'bound', jobId: 'parent', turnId: 'turn', state: 'unknown', reason: 'answer-unavailable' }))
    expect(registry.getSnapshot(token.notebookId)).toMatchObject({ busy: null, receipt: { jobId: 'parent', turnId: 'turn' }, reason: 'answer-unavailable' })
  })
  it('A to B to A cannot revive an old capture or token', () => {
    render(<TurnOperationProvider><Consumer /></TurnOperationProvider>); const token = admit(); const context = readTurnContext()!
    act(() => { publishTurnTarget({ ...target, apiBase: 'https://other.example/api' }, true); publishTurnTarget(target, true) })
    expect(registry.admit(input(context))).toEqual({ ok: false, reason: 'unavailable' })
    act(() => registry.settlePost(token, { kind: 'not-dispatched' })); expect(registry.getSnapshot(token.notebookId)).toBeNull()
  })
  it('facade closes the child-layout-effect to provider-subscription setup gap', () => {
    let before!: TurnRegistry
    let oldToken!: AttemptToken
    function BeforeSubscription() {
      const owner = useTurnOperationRegistry()
      useLayoutEffect(() => {
        before = owner
        const result = owner.admit(input()); if (!result.ok) throw new Error('Admission rejected'); oldToken = result.token
        invalidateTurnContext()
        // The provider passive effect has not subscribed yet. The facade must independently re-check.
        expect(owner.getSnapshot(oldToken.notebookId)).toBeNull()
        owner.settlePost(oldToken, { kind: 'bound', jobId: 'late', turnId: 'late', state: 'queued', dispatchUnknown: false })
        expect(owner.beginRetry(oldToken.operationId)).toBeNull()
      }, [owner])
      return null
    }
    render(<TurnOperationProvider><BeforeSubscription /></TurnOperationProvider>)
    expect(before.getSnapshot(oldToken.notebookId)).toBeNull()
  })
  it('StrictMode setup/cleanup causes zero dispatch and allows fresh explicit admission afterwards', () => {
    const view = render(<StrictMode><TurnOperationProvider><Consumer /></TurnOperationProvider></StrictMode>)
    expect(fetch).not.toHaveBeenCalled(); expect(screen.getByTestId('operation')).toHaveTextContent('none')
    const token = admit(); expect(screen.getByTestId('operation')).toHaveTextContent(token.operationId)
    expect(fetch).not.toHaveBeenCalled(); const old = registry; view.unmount(); expect(old.getSnapshot(token.notebookId)).toBeNull()
  })
  it('snapshots remain referentially stable until an operation changes', () => {
    render(<TurnOperationProvider><Consumer /></TurnOperationProvider>); const token = admit()
    const snapshot = registry.getSnapshot(token.notebookId)
    expect(registry.getSnapshot(token.notebookId)).toBe(snapshot)
    act(() => suspendTurnTarget()); expect(registry.getSnapshot(token.notebookId)).toBe(snapshot)
  })
})
