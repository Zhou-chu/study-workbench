/** Browser-only loopback adapter. No nginx/production parity is implied. */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { bytes } from '../../../v1/spa-artifact-common.mjs';
import { prepareStaging } from './release-preflight.mjs';

const types = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.bcmap': 'application/octet-stream', '.wasm': 'application/wasm',
};
const shell = /^\/(?:|notebooks(?:\/[A-Za-z0-9_:%-]+(?:\/study)?)?|login|settings(?:\/(?:models|api-keys))?)$/;

export function routeTarget(target, staticFiles) {
  if (typeof target !== 'string' || !target.startsWith('/')) return null;
  const pathname = target.split('?', 1)[0];
  if (/[%](?!3[aA])|\/\/|\\|(?:^|\/)\.{1,2}(?:\/|$)/.test(pathname)) return null;
  if (/^\/(?:api|config)(?:\/|$)/.test(pathname)) return 'bff';
  if (shell.test(pathname)) return 'index.html';
  const rendered = pathname.slice(1);
  return staticFiles.has(rendered) ? rendered : null;
}

export function servingInventory(target) {
  const rows = new Map();
  const release = '_spa/releases/' + target.releaseSlot + '/';
  for (const row of target.staticFiles) {
    if (row.path === 'index.html' || row.path.startsWith('pdfjs/')) rows.set(row.path, row);
    else if (row.path.startsWith('assets/') || row.path === 'theme-bootstrap.js') rows.set(release + row.path, row);
  }
  rows.set(release + 'spa-artifact-manifest.json', target.manifest);
  return rows;
}

function response(res, code, type, content) {
  res.writeHead(code, {
    'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
  });
  res.end(content);
}

export function createFixtureGateway({ adapter, target, gateway }) {
  const inventory = servingInventory(target);
  return createServer(async (req, res) => {
    const route = routeTarget(req.url, inventory);
    if (route === 'bff') return adapter(req, res);
    if (!route || !['GET', 'HEAD'].includes(req.method) || !inventory.has(route))
      return response(res, 404, 'text/plain', 'Not found\n');
    try {
      const row = inventory.get(route);
      const content = (await bytes(path.join(gateway, route))).data;
      if (content.length !== row.size || createHash('sha256').update(content).digest('hex') !== row.sha256)
        throw Error('Wire inventory mismatch');
      response(res, 200, types[path.extname(route)] || 'application/octet-stream',
        req.method === 'HEAD' ? undefined : content);
    } catch {
      response(res, 500, 'text/plain', 'Artifact unavailable\n');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourceCommit, web, bff, gateway, proofFile] = process.argv.slice(2);
  const port = Number(process.env.PORT);
  if (!sourceCommit || !web || !bff || !gateway || !proofFile ||
      !(Number.isSafeInteger(port) && port >= 1024 && port <= 65535) ||
      process.env.STUDY_WORKBENCH_WEB_ORIGIN !== 'http://127.0.0.1:' + port)
    throw Error('Invalid fixture gateway configuration');
  const target = await prepareStaging({ sourceCommit, web, bff, gateway });
  const importBff = filename => import(pathToFileURL(path.resolve(bff, filename)));
  const { createBffHandler, getWebSessionConfig } = await importBff('server.js');
  const { createHttpAdapter } = await importBff('http-adapter.js');
  const config = getWebSessionConfig();
  const server = createFixtureGateway({ adapter: createHttpAdapter(createBffHandler(config), config), target, gateway });
  await writeFile(proofFile, JSON.stringify(target), { flag: 'wx', mode: 0o600 });
  server.listen(port, '127.0.0.1');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
}
