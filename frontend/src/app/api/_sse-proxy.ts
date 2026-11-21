import { dispatchApiRequest } from '@/lib/api/session-proxy'

/** Both legacy POST consumers and device streams share the non-buffering BFF. */
export function sseProxy(req: Request, upstreamPath: string) {
  return dispatchApiRequest(req, upstreamPath)
}
