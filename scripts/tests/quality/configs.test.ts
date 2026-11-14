import {afterEach,expect,it,vi} from 'vitest';
import {coverageConfig} from '../../coverage-config';
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
it.each(['web','legacy-web','contracts','domain','bff','web-transport'])('coverage config retains untouched production src for %s',name=>{
 const config=coverageConfig(name);expect(config.envDir).toBe(false);
 expect(config.test?.coverage).toMatchObject({enabled:true,provider:'v8',include:['src/**/*.{ts,tsx,js,jsx,mjs,cjs}'],reportOnFailure:true});
 expect(config.test?.coverage?.exclude?.includes('src/test/**')).toBe(['web','legacy-web'].includes(name));
});
it('workspace coverage entrypoints retain their own report destinations',async()=>{
 const configs=await Promise.all([import('../../../apps/web/coverage.config'),import('../../../apps/bff/coverage.config'),import('../../../packages/contracts/coverage.config'),import('../../../packages/domain/coverage.config'),import('../../../packages/web-transport/coverage.config')]);
 expect(configs.map(c=>c.default.test?.coverage?.reportsDirectory?.split('/').filter(Boolean).at(-1))).toEqual(['web','bff','contracts','domain','web-transport']);
});
it('Vite absent/empty identity uses root base; release identity stays in its own slot',async()=>{
 for(const value of [undefined,'']){vi.stubEnv('SPA_ARTIFACT_IDENTITY',value);vi.resetModules();const config=(await import('../../../apps/web/vite.config')).default;expect(config.base).toBe('/');expect(config.define?.__SPA_ARTIFACT__).toBe('null');expect(config.server?.host).toBe('127.0.0.1');}
 vi.stubEnv('SPA_ARTIFACT_IDENTITY','{"release_slot":"test-slot"}');vi.resetModules();
 const config=(await import('../../../apps/web/vite.config')).default;
 expect(config.base).toBe('/_spa/releases/test-slot/');expect(config.envDir).toBe(false);expect(config.build?.sourcemap).toBe(false);
});
it('Vite malformed artifact identity fails rather than silently building wrong base',async()=>{
 vi.stubEnv('SPA_ARTIFACT_IDENTITY','{bad');vi.resetModules();await expect(import('../../../apps/web/vite.config')).rejects.toThrow();
});
it('deployment and tooling configurations include real production files, not only imports',async()=>{
 const deployment=(await import('../../coverage-deployment.config')).default;
 expect(deployment.test?.coverage?.include).toEqual(['examples/easypanel/index.ts','frontend/next.config.ts']);
 const tooling=(await import('../../coverage-quality.config')).default;
 expect(tooling.test?.maxWorkers).toBe(1);
 expect(tooling.test?.coverage?.include).toEqual(expect.arrayContaining(['scripts/coverage-workspaces.mjs','scripts/coverage-gate.mjs','frontend/coverage.config.ts']));
 expect(tooling.test?.coverage?.exclude).toEqual([]);
});

it('PostCSS retains the real Tailwind plugin declaration',async()=>{
 const config=(await import('../../../frontend/postcss.config.mjs')).default;
 expect(config.plugins).toEqual(['@tailwindcss/postcss']);
});
