import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
/** Explicit inclusion includes untouched files, entrypoints, and runtime locale tables. */
export function coverageConfig(partition: string) {
 return defineConfig({envDir:false,test:{
  include:['src/**/*.{test,spec}.{ts,tsx,js,jsx}','test/**/*.{test,spec}.{ts,tsx,js,jsx}'],
  maxWorkers:2,
  reporters:['default','json'],
  outputFile:{json:fileURLToPath(new URL('../coverage/diagnostics/'+partition+'-tests.json',import.meta.url))},
  coverage:{
   enabled:true,provider:'v8',
   include:['src/**/*.{ts,tsx,js,jsx,mjs,cjs}'],
   exclude:['**/*.test.*','**/*.spec.*','**/*.d.ts',...((partition==='web'||partition==='legacy-web')?['src/test/**']:[])],
   reporter:['text','json','json-summary','lcov'],
   reportsDirectory:fileURLToPath(new URL('../coverage/'+partition+'/',import.meta.url)),
   reportOnFailure:true,
  }
 }});
}
