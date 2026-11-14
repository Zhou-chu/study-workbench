import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
 envDir:false,
 resolve:{alias:{'~templates-utils':fileURLToPath(new URL('./tests/deployment/templates-utils.ts',import.meta.url))}},
 test:{
  include:['scripts/tests/deployment/*.test.ts'], maxWorkers:1,
  reporters:['default','json'],outputFile:{json:'coverage/diagnostics/deployment-config-tests.json'},
  coverage:{enabled:true,provider:'v8',include:['examples/easypanel/index.ts','frontend/next.config.ts'],
   reporter:['text','json','json-summary','lcov'],reportsDirectory:'coverage/deployment-config',reportOnFailure:true}
 }
});
