import { parseWorkspaceView, parseTurnView, type TurnReceipt } from '@study/contracts'
import { reconcileTurn, type TurnCapture, type TurnMatch } from '@study/domain'
import type { WebTransport } from './client.js'
/** Deliberate check only. Generic GET job may dispatch and is never used here. */
export async function checkTurnRecovery(transport: WebTransport, capture: TurnCapture, receipt?: TurnReceipt, signal?: AbortSignal): Promise<TurnMatch> {
  try {
    const options = { method: 'GET', context: capture.context, ...(signal ? { signal } : {}) }
    const workspaceResponse = await transport.send({ ...options, path: `/personal/notebooks/${encodeURIComponent(capture.dto.notebook_id)}/workspace-view` })
    const historyResponse = await transport.send({ ...options, path: `/personal/chats/${encodeURIComponent(capture.sessionId)}/turns` })
    if (!workspaceResponse.ok || !historyResponse.ok) return { kind: 'unknown', reason: 'unconfirmed' }
    const workspace = parseWorkspaceView(await workspaceResponse.json())
    const history: unknown = await historyResponse.json()
    return reconcileTurn(capture,workspace,Array.isArray(history) ? history.map(value => parseTurnView(value)) : history,receipt,'workspace-view-v1')
  } catch { return { kind: 'unknown', reason: 'unconfirmed' } }
}
