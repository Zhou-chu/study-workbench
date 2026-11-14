import { expect, it, expectTypeOf } from 'vitest';
import type { RuntimeConfig } from './index.js';
it('exports the exact same-origin runtime wire contract', () => { const value: RuntimeConfig = { apiUrl: '', auth_mode: 'legacy_password', web_session_protocol: null, client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1 }; expectTypeOf(value.apiUrl).toEqualTypeOf<''>(); expectTypeOf(value.client_contracts).toEqualTypeOf<readonly string[]>(); expect(value.ui_transport_protocol).toBe(1); });
