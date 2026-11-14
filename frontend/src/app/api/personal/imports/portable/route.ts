import { dispatchApiRequest } from '@/lib/api/session-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Never clone/read the body. The common device policy validates Origin/CSRF and
// fresh authority first, then forwards this original stream; API owns ZIP limits.
const dispatch = (req: Request) => dispatchApiRequest(req, '/api/personal/imports/portable')
export const GET = dispatch
export const HEAD = dispatch
export const POST = dispatch
export const PUT = dispatch
export const PATCH = dispatch
export const DELETE = dispatch
export const OPTIONS = dispatch
