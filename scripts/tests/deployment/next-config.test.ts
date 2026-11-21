import { afterEach, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
async function load(value:string|undefined){
 vi.stubEnv('NEXT_ALLOWED_DEV_ORIGINS',value);vi.resetModules();
 return (await import('../../../frontend/next.config')).default;
}
it.each([undefined,'',' , , ','  '])('omits empty origins rather than allowing an empty host (%s)',async value=>{
 const config=await load(value);expect(config).not.toHaveProperty('allowedDevOrigins');
});
it('trims comma-separated hosts and discards blank entries',async()=>{
 const config=await load(' localhost, ,192.0.2.1, research.local ,');
 expect(config.allowedDevOrigins).toEqual(['localhost','192.0.2.1','research.local']);
});
it('does not retain origins across isolated imports',async()=>{
 expect((await load('first.local')).allowedDevOrigins).toEqual(['first.local']);
 expect(await load(undefined)).not.toHaveProperty('allowedDevOrigins');
});
it('keeps standalone tracing local and redirects legacy credentials without a bypass rewrite',async()=>{
 const config=await load(undefined);
 expect(config.output).toBe('standalone');
 expect(config.outputFileTracingRoot).toBe(resolve('frontend'));
 expect(config).not.toHaveProperty('rewrites');
 expect(await config.redirects!()).toEqual([{source:'/settings/api-keys',destination:'/settings/models',permanent:true}]);
});
