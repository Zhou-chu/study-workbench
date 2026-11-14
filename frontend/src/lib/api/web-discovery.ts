import apiClient from './client'

export interface WebSearchStatus {
  state: 'ready' | 'configuration_required'
  provider: 'firecrawl'
  configured: boolean
  access_mode: 'api_key' | 'keyless_trial' | null
  trial_limits: { scope: 'server_ip'; period: 'daily'; numeric_caps_published: false } | null
  automatic_paid_fallback: false
  reason: string | null
  settings_url: string
  max_results: number
  externally_verified: false
}

export interface WebResult {
  id: string
  url: string
  title: string
  snippet: string
  domain: string
}

export interface WebSearchResponse {
  provider: 'firecrawl'
  searched_at: string
  results: WebResult[]
  total_count: number
}

export interface WebImportResponse {
  state: 'queued' | 'already_imported' | 'saved'
  source_id: string
  source_version_id: string
  job_id: string | null
  url: string
  warning: string | null
}

export const webDiscoveryApi = {
  status: async (signal?: AbortSignal) => (await apiClient.get<WebSearchStatus>('/personal/web-search/status', { signal })).data,
  search: async (query: string, signal?: AbortSignal) => (await apiClient.post<WebSearchResponse>('/personal/web-search', { query, limit: 6 }, { signal, timeout: 25000 })).data,
  importSource: async (notebookId: string, result: WebResult, idempotencyKey: string) => (await apiClient.post<WebImportResponse>(`/personal/notebooks/${encodeURIComponent(notebookId)}/sources/web-import`, {
    url: result.url, title: result.title, snippet: result.snippet, provider: 'firecrawl', idempotency_key: idempotencyKey,
  }, { timeout: 55000 })).data,
}

export function webDiscoveryErrorKey(error: unknown): string {
  const value = error as { response?: { data?: { detail?: string | { code?: string }; error?: { code?: string } } } }
  const detail = value?.response?.data?.detail
  const code = typeof detail === 'string' ? detail : detail?.code || value?.response?.data?.error?.code
  const key: Record<string, string> = {
    WEB_SEARCH_CONFIGURATION_REQUIRED: 'webDiscovery.errors.configuration', WEB_SEARCH_UNSUPPORTED_API_ORIGIN: 'webDiscovery.errors.configuration',
    WEB_SEARCH_UNSUPPORTED_ACCESS_MODE: 'webDiscovery.errors.configuration',
    WEB_PROVIDER_RATE_LIMIT: 'webDiscovery.errors.rateLimit', WEB_PROVIDER_TIMEOUT: 'webDiscovery.errors.timeout', WEB_PROVIDER_ERROR: 'webDiscovery.errors.provider',
    WEB_INVALID_URL: 'webDiscovery.errors.invalidUrl', WEB_EMPTY_CONTENT: 'webDiscovery.errors.emptyContent', WEB_RESPONSE_TOO_LARGE: 'webDiscovery.errors.tooLarge',
    WEB_IDEMPOTENCY_CONFLICT: 'webDiscovery.errors.idempotencyConflict',
    WEB_IMPORT_IN_PROGRESS: 'webDiscovery.errors.inProgress', WEB_IMPORT_OUTCOME_UNKNOWN: 'webDiscovery.errors.outcomeUnknown',
    WEB_IMPORTED_SOURCE_UNAVAILABLE: 'webDiscovery.errors.sourceUnavailable',
  }
  return code && key[code] || 'webDiscovery.errors.generic'
}
