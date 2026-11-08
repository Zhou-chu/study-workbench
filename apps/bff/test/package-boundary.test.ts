import { readFileSync, readdirSync } from 'node:fs'
import { expect, it } from 'vitest'
it('publishes only a Node entry and keeps listening in the CLI alone', () => {
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))
 expect(pkg.exports['.'].node).toEqual({import:'./dist/server.js'})
 expect(pkg.exports['.'].default).toBeNull()
 const directory=new URL('../src/',import.meta.url)
 for(const file of readdirSync(directory).filter(file=>file.endsWith('.ts')&&file!=='cli.ts'))expect(readFileSync(new URL(file,directory),'utf8')).not.toMatch(/\.listen\s*\(/)
})
