import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
it('checks actual CSS token pairs for text and essential boundaries', () => { const result = spawnSync(process.execPath, ['scripts/check-contrast.mjs'], { encoding: 'utf8' }); expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain('24 token pairs passed'); });
