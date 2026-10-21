import { sseProxy } from '../../../../../../_sse-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function dispatch(req: Request, { params }: { params: Promise<{ sourceId: string; sessionId: string }> }) {
  const { sourceId, sessionId } = await params
  // This path is used solely for legacy compatibility. Device dispatch matches
  // the original raw request URL, never these decoded/reconstructed params.
  return sseProxy(req, `/api/sources/${encodeURIComponent(sourceId)}/chat/sessions/${encodeURIComponent(sessionId)}/messages`)
}
export const GET = dispatch
export const HEAD = dispatch
export const POST = dispatch
export const PUT = dispatch
export const PATCH = dispatch
export const DELETE = dispatch
export const OPTIONS = dispatch
