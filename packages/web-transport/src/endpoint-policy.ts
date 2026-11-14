import { RequestNotDispatchedError } from './errors.js'
export function protectedApiPath(url: string): string {
  if (!url.startsWith('/') || url.startsWith('//') || /[\\#\u0000-\u0020\u007f]/.test(url)) throw new RequestNotDispatchedError('destination')
  let decoded = url.split('?')[0]!
  try {
    for (let i = 0; i < 4; i++) {
      if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.split('/').some(segment => segment === '.' || segment === '..')) throw new Error()
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }
    if (/%(?:25|2e|5c)/i.test(decoded) || /[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.split('/').some(segment => segment === '.' || segment === '..')) throw new Error()
  } catch { throw new RequestNotDispatchedError('destination') }
  const path = url.startsWith('/api/') ? url.slice(4) : url
  if (path === '/' || path === '/api') throw new RequestNotDispatchedError('destination')
  return path
}


export function endpointPolicy(method: string, path: string): { retry: false; prefetch: false; dedupeKey?: string } {
  const normalized = protectedApiPath(path)
  return { retry: false, prefetch: false, ...(method.toUpperCase() === 'GET' && /^\/personal\/jobs\/[^/?]+(?:\?[^#]*)?$/.test(normalized) ? { dedupeKey: `GET /api${normalized}` } : {}) }
}
