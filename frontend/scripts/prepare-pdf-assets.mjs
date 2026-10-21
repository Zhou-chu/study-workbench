import { cp, mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'node_modules', 'pdfjs-dist')
const { version } = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'))
if (version !== '6.4.299') throw new Error(`Unexpected PDF.js version: ${version}`)
const destination = path.join(root, 'public', 'pdfjs', version)
await mkdir(destination, { recursive: true })
for (const asset of ['cmaps', 'standard_fonts', 'wasm', 'LICENSE']) {
  await cp(path.join(source, asset), path.join(destination, asset), { recursive: true })
}
await cp(path.join(source, 'build', 'pdf.worker.min.mjs'), path.join(destination, 'pdf.worker.min.mjs'))
console.log(`Prepared local PDF.js ${version} worker and assets`)
