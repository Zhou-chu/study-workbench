import { describe, expect, it, vi } from 'vitest';
import { createBffHandler, createBffServer } from '../src/server.js';
import { getWebSessionConfig } from '../src/config.js';
import { config } from './fixtures.js';

for (const mode of ['legacy_password', 'device_sessions'] as const) {
    describe(mode, () => {
        it.each([null, '', 'https://x.example/', 'https://x.example,https://y.example', 'http://localhost:3000'])('rejects invalid trusted config before readiness %s', publicOrigin => { const cfg = { ...config(mode), publicOrigin } as ReturnType<typeof config>; expect(() => createBffHandler(cfg)).toThrow('AUTH_UNAVAILABLE'); expect(() => createBffServer(cfg)).toThrow('AUTH_UNAVAILABLE'); });
    });
}

it('requires explicit trusted legacy origin from environment without header inference', () => { vi.stubEnv('STUDY_WORKBENCH_AUTH_MODE', 'legacy_password'); vi.stubEnv('STUDY_WORKBENCH_WEB_ORIGIN', undefined); expect(() => getWebSessionConfig()).toThrow('AUTH_UNAVAILABLE'); vi.unstubAllEnvs(); });
