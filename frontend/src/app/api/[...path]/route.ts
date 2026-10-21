import { dispatchApiRequest } from '@/lib/api/session-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Explicit methods prevent Next's automatic HEAD/OPTIONS fallbacks from
// bypassing the exact registered method policy. Decoded params are not routing.
const dispatch = (req: Request) => dispatchApiRequest(req)
export const GET = dispatch
export const HEAD = dispatch
export const POST = dispatch
export const PUT = dispatch
export const PATCH = dispatch
export const DELETE = dispatch
export const OPTIONS = dispatch
