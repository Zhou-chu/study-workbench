import { expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
const root = resolve(import.meta.dirname,'../..')
function sourceFiles(directory: string): string[] { return readdirSync(directory,{ withFileTypes:true }).flatMap(entry => entry.isDirectory() ? sourceFiles(resolve(directory,entry.name)) : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [resolve(directory,entry.name)] : []) }
it('compiles contracts and domain with ES-only globals and no platform ambient types', () => {
  const files = ['contracts','domain'].flatMap(name => sourceFiles(resolve(root,name,'src')))
  const program = ts.createProgram(files,{ target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,skipLibCheck:true,noEmit:true,types:[],lib:['lib.es2022.d.ts'] })
  expect(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText,'\n'))).toEqual([])
})
it('keeps browser graphs free of server/legacy imports and credentials out of public feature APIs', async () => {
  for (const name of ['contracts','domain','web-transport']) {
    for (const file of sourceFiles(resolve(root,name,'src'))) {
      const text = readFileSync(file,'utf8'); const imports = [...text.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g)].map(match=>match[1]!)
      expect(imports.filter(value => /^(?:node:|react|next|@\/|@study\/bff)|frontend|apps\/bff|^\.\.\//.test(value)),file).toEqual([])
      if (!file.endsWith('legacy-auth.ts')) expect(text,file).not.toMatch(/localStorage\.(?:getItem|setItem|removeItem)|sessionStorage|indexedDB/)
    }
  }
  const api = await import('./index.js')
  expect(api).not.toHaveProperty('getAuthToken'); expect(api).not.toHaveProperty('setLegacyAuthToken'); expect(api).not.toHaveProperty('dispatchRequest')
  const pkg = JSON.parse(readFileSync(resolve(root,'web-transport/package.json'),'utf8'))
  expect(Object.keys(pkg.exports)).toEqual(['.'])
})
