export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A filesystem route takes precedence over the external /api rewrite, whose
// Next.js body cloning truncates large uploads. Keep this path streaming: never
// call formData(), text(), arrayBuffer(), or clone() on the request.
export async function POST(req: Request) {
  const headers = new Headers()
  for (const name of ['authorization', 'content-type', 'origin']) {
    const value = req.headers.get(name)
    if (value) headers.set(name, value)
  }
  const length = req.headers.get('content-length')
  if (length && /^\d+$/.test(length)) headers.set('content-length', length)
  const responseHeaders = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  const backend = process.env.INTERNAL_API_URL || 'http://localhost:5055'
  try {
    const options: RequestInit & { duplex: 'half' } = {
      method: 'POST', headers, body: req.body, duplex: 'half',
      signal: req.signal, cache: 'no-store', redirect: 'manual',
    }
    const upstream = await fetch(`${backend.replace(/\/$/, '')}/api/personal/imports/portable`, options)
    responseHeaders.set('Content-Type', upstream.headers.get('content-type') || 'application/json')
    const challenge = upstream.headers.get('www-authenticate')
    if (challenge) responseHeaders.set('WWW-Authenticate', challenge)
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch {
    if (req.signal.aborted) return new Response(null, { status: 499, headers: responseHeaders })
    return Response.json({ detail: 'Portable upload service is unavailable.' }, { status: 502, headers: responseHeaders })
  }
}
