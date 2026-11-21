import { expect, it } from 'vitest';

it('tooling configuration scans for real production files, not only imports', async () => {
 const tooling=(await import('../../coverage-quality.config')).default;
 expect(tooling.test?.maxWorkers).toBe(1);
 expect(tooling.test?.coverage?.include).toEqual(expect.arrayContaining(['scripts/coverage-workspaces.mjs','scripts/coverage-gate.mjs','frontend/coverage.config.ts']));
 expect(tooling.test?.coverage?.exclude).toEqual([]);
});
