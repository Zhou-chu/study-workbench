import { sseProxy } from '../../_sse-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const dispatch = (req: Request) => sseProxy(req, '/api/search/ask')
export const GET = dispatch
export const HEAD = dispatch
export const POST = dispatch
export const PUT = dispatch
export const PATCH = dispatch
export const DELETE = dispatch
export const OPTIONS = dispatch
