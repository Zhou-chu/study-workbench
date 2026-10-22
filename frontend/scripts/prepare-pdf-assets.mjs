import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { noSymlinkPath, readPublicFile, treeInventory } from './artifact-identity.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'node_modules', 'pdfjs-dist')
await noSymlinkPath(source)
const { version } = JSON.parse((await readPublicFile(path.join(source, 'package.json'))).toString('utf8'))
if (version !== '6.4.299') throw new Error(`Unexpected PDF.js version: ${version}`)
const destination = path.join(root, 'public', 'pdfjs', version)
await noSymlinkPath(path.join(root, 'public', 'pdfjs'))
for (const asset of ['cmaps', 'standard_fonts', 'wasm']) await treeInventory(path.join(source, asset))
const regularAssets = await Promise.all(['LICENSE', 'build/pdf.worker.min.mjs'].map(async asset => [path.basename(asset), await readPublicFile(path.join(source, asset))]))
await rm(path.join(root, 'public', 'pdfjs'), { recursive: true, force: true })
await mkdir(destination, { recursive: true })
for (const asset of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(path.join(source, asset), path.join(destination, asset), { recursive: true })
}
for (const [name, bytes] of regularAssets) await writeFile(path.join(destination, name), bytes, { flag: 'wx' })
console.log(`Prepared local PDF.js ${version} worker and assets`)
