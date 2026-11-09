import { defineConfig } from 'vitest/config'
const identity=process.env.SPA_ARTIFACT_IDENTITY ? JSON.parse(process.env.SPA_ARTIFACT_IDENTITY) as {release_slot:string} : null;
export default defineConfig({ envDir:false, base: identity ? '/_spa/releases/'+identity.release_slot+'/' : '/', define: { __SPA_ARTIFACT__: JSON.stringify(identity) }, build:{sourcemap:false}, test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], css: true }, server: { host: '127.0.0.1' } })
