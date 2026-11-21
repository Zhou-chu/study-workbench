const localErrors = new WeakSet<object>()
export class RequestNotDispatchedError extends Error {
  constructor(readonly reason: 'authentication' | 'configuration' | 'destination' | 'superseded' | 'duplicate' | 'aborted') {
    super('Request was not sent'); this.name = 'RequestNotDispatchedError'; localErrors.add(this)
  }
}
export function asRequestNotDispatchedError(error: unknown): RequestNotDispatchedError | null {
  const seen = new Set<object>(); let value = error
  while (value && typeof value === 'object' && !seen.has(value)) {
    if (localErrors.has(value)) return value as RequestNotDispatchedError
    seen.add(value); value = Object.getOwnPropertyDescriptor(value, 'cause')?.value
  }
  return null
}
/** Never means not-sent: the request may already have committed. No raw body or Location retained. */
export class TransportResponseError extends Error {
  declare readonly status?: number
  constructor(readonly kind: 'unavailable' | 'ingress-unavailable' | 'unexpected-response' | 'retired', status?: number) {
    super(kind === 'retired' ? 'Response belongs to an earlier session or target' : 'Connection unavailable; check before retrying'); this.name = 'TransportResponseError'; if (status !== undefined) this.status = status
  }
}
