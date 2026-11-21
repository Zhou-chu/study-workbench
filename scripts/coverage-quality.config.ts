import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
import {relative} from 'node:path';
import {qualityToolingFiles} from './coverage-inventory.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export default defineConfig({envDir:false,test:{
 include:['scripts/tests/quality/*.test.ts'],maxWorkers:1,
 reporters:['default','json'],outputFile:{json:'coverage/diagnostics/quality-tooling-tests.json'},
 coverage:{enabled:true,provider:'v8',include:qualityToolingFiles(root).map(file=>relative(root,file)),exclude:[],
 reporter:['text','json','json-summary','lcov'],reportsDirectory:'coverage/quality-tooling',reportOnFailure:true}
}});
