/** BFF self-report only; actual API support requires authenticated capabilities. */
export type RuntimeConfig = {
  apiUrl: ''
  auth_mode: 'legacy_password' | 'device_sessions'
  web_session_protocol: 'bff-memory-v1' | null
  client_contracts: readonly string[]
  ui_transport_protocol: 1
}
