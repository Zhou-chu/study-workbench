import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { chromium } from 'playwright-core';
const endpointLabels = new Map([
  ['/config', 'runtime-config'],
  ['/api/auth/status', 'auth-status'],
  ['/api/personal/client-capabilities', 'capabilities'],
  ['/api/personal/notebooks/synthetic/workspace-view', 'workspace'],
  ['/api/personal/chats/v1_synthetic/turns', 'chat-history'],
  ['/api/personal/notebooks/synthetic/selection', 'selection'],
  ['/api/personal/source-versions/version-a', 'detail-a'],
  ['/api/personal/source-versions/version-a/download', 'download-a'],
  ['/api/personal/source-versions/version-b', 'detail-b'],
  ['/api/personal/source-versions/version-b/download', 'download-b'],
  ['/pdfjs/6.4.299/pdf.worker.min.mjs', 'pdf-worker'],
]);
function failureReport(stage, sourceCommit, evidence) {
  const rows = Array.isArray(evidence?.requests) ? evidence.requests.slice(-32) : [];
  const requests = rows.flatMap(row => {
    const route = endpointLabels.get(row?.path);
    if (!route || !['GET', 'PATCH'].includes(row.method) ||
        !Number.isInteger(row.status) || row.status < 100 || row.status > 599) return [];
    return [{ route, method: row.method, status: row.status }];
  });
  return { status: 'fail', stage, sourceCommit: /^[a-f0-9]{40}$/.test(sourceCommit ?? '') ? sourceCommit : null, requests };
}

if (process.argv[2] === '--failure-witness') {
  const [snapshot, reason, sha] = process.argv.slice(3);
  let evidence;
  try {
    if (statSync(snapshot).size <= 64 * 1024) evidence = JSON.parse(readFileSync(snapshot, 'utf8'));
  } catch { /* startup may not have created a complete snapshot */ }
  const stage = reason === 'fixture-start' ? 'fixture-start' : 'probe-start-or-timeout';
  console.log(JSON.stringify(failureReport(stage, sha, evidence)));
  process.exit(0);
}
const [origin] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(origin ?? ''))
  throw new Error('Usage: node probe.mjs http://127.0.0.1:<fixture-port>');
const evidenceUrl = origin + '/__fixture_evidence';
const evidence = async (signal) => (await fetch(evidenceUrl, { signal, redirect: 'error' })).json();
let start, browser;
let stage = 'fixture-manifest';
try {
  start = await evidence();
  assert.equal(start.artifactKind, 'verified-release-manifests', 'Diagnostic build lacks runtime artifact identity; do not run browser against it');
  assert.equal(start.artifact.source_commit, start.expectedSourceCommit);
  stage = 'chromium-start';
  browser = await chromium.launch({ executablePath: chromium.executablePath(), chromiumSandbox: true, headless: true });
  const reasons = { errors: [], rejectedOrigins: [] };
  stage = 'navigate-workspace';
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'en-US', serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const destination = new URL(route.request().url());
    if (destination.origin === origin || destination.protocol === 'blob:') return route.continue();
    reasons.rejectedOrigins.push(destination.origin);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => reasons.errors.push(error.name));
  await page.goto(origin + '/notebooks/synthetic', { waitUntil: 'domcontentloaded' });
  stage = 'open-sources-section';
  const section = name => page.getByRole('navigation', { name: 'Workspace sections', exact: true })
    .getByRole('button', { name, exact: true });
  await section('Sources').click();
  stage = 'open-source-a-scope';
  const titleA = page.getByRole('button', { name: 'PDF fixture A', exact: true });
  const titleB = page.getByRole('button', { name: 'PDF fixture B', exact: true });
  const scope = titleA.locator('xpath=ancestor::li[1]').getByRole('button', { name: 'Current question scope' });
  await scope.click();
  const selection = page.getByRole('checkbox', { name: 'Select PDF fixture A · Version 1' });
  stage = 'select-source-a';
  await selection.check();
  stage = 'settle-source-a-scope';
  await waitEvidence(member => member.current.source_version_ids.join() === 'version-a');
  await selection.and(page.locator(':enabled')).waitFor({ state: 'visible' });
  const witness = [];
  function reader() { return page.getByRole('region', { name: 'Reader', exact: true }).and(page.locator('.reader-pane')); }
  async function assertRaster(num, total, actualSize = false) {
    const r = reader();
    await r.getByText('/ ' + total, { exact: true }).waitFor({ state: 'visible' });
    const input = r.getByRole('spinbutton');
    assert.equal(await input.inputValue(), String(num));
    assert.equal(await input.getAttribute('max'), String(total));
    let canvas = r.locator('canvas[data-render-state="ready"][data-page-number="' + num + '"]');
    if (actualSize) {
      await r.getByRole('button', { name: '100%', exact: true }).click();
      // A uses a 595×842 PDF viewport. Fixed zoom and DPR make the comparisons independent of panel width.
      canvas = canvas.and(r.locator('canvas[width="595"][height="842"]'));
    }
    await canvas.waitFor({ state: 'visible' });
    const raster = await canvas.evaluate(async node => {
      const { width, height } = node;
      const pixels = node.getContext('2d').getImageData(0, 0, width, height).data;
      let inkPixels = 0;
      for (let k = 0; k < pixels.length; k += 4)
        if (pixels[k + 3] > 0 && Math.min(pixels[k], pixels[k + 1], pixels[k + 2]) < 245) inkPixels++;
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', pixels));
      return { width, height, inkPixels, pixelSha256: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') };
    });
    assert.ok(raster.width > 0 && raster.height > 0 && raster.inkPixels > 0);
    assert.equal(await r.locator('[data-pdf-fallback=true]').count(), 0);
    if (!actualSize) witness.push({ page: num, physicalCount: total, ...raster });
    return raster;
  }
  async function waitEvidence(check) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const observed = await evidence();
      if (check(observed)) return observed;
      await new Promise(resolve => setTimeout(resolve, 125));
    }
    throw new Error('Expected synthetic fixture request or state did not settle');
  }
  stage = 'raster-a-page-1';
  await titleA.click();
  await assertRaster(1, 3);
  for (const current of [2, 3]) {
    stage = current === 2 ? 'raster-a-page-2' : 'raster-a-page-3';
    await reader().getByRole('button', { name: 'Next', exact: true }).click();
    await assertRaster(current, 3);
    await waitEvidence(member => member.current.reading?.source_version_id === 'version-a' && member.current.reading.page_index === current - 1);
    await reader().getByRole('button', { name: 'Save reading position', exact: true }).waitFor({ state: 'hidden' });
  }
  assert.ok(await reader().getByRole('button', { name: 'Next', exact: true }).isDisabled());
  stage = 'actual-size-manual-a-page-3';
  const manualA3 = await assertRaster(3, 3, true);
  stage = 'raster-b-page-1';
  await reader().getByRole('button', { name: 'Close', exact: true }).click();
  await titleB.click();
  await assertRaster(1, 4);
  stage = 'independent-scope-ledger';
  const result = await waitEvidence(member => member.requests.some(row => row.path.endsWith('/version-b/download')));
  assert.deepEqual(result.current.source_version_ids, ['version-a']);
  const writes = result.requests.filter(row => row.method === 'PATCH' && row.status === 200);
  assert.deepEqual(writes.map(row => row.syntheticSelected), [['version-a'], ['version-a'], ['version-a']]);
  assert.deepEqual(writes.map(row => row.syntheticReading), [null,
    { source_version_id: 'version-a', page_index: 1 },
    { source_version_id: 'version-a', page_index: 2 }]);
  assert.equal(new Set(witness.map(item => item.pixelSha256)).size, 4);
  assert.equal(result.requests.filter(row => row.path.endsWith('/download') && row.status === 200).length, 2);
  assert.equal(reasons.rejectedOrigins.length, 0);
  assert.equal(reasons.errors.length, 0);
  assert.ok(result.requests.some(row => row.path.endsWith('/pdf.worker.min.mjs') && row.status === 200));
  stage = 'select-b-only-for-citation';
  await reader().getByRole('button', { name: 'Close', exact: true }).click();
  await selection.uncheck();
  await waitEvidence(member => member.current.source_version_ids.length === 0);
  await selection.and(page.locator(':enabled')).waitFor({ state: 'visible' });
  await titleB.locator('xpath=ancestor::li[1]').getByRole('button', { name: 'Current question scope' }).click();
  const selectedB = page.getByRole('checkbox', { name: 'Select PDF fixture B · Version 1' });
  await selectedB.check();
  const beforeCitation = await waitEvidence(member => member.current.source_version_ids.join() === 'version-b');
  await selectedB.and(page.locator(':enabled')).waitFor({ state: 'visible' });
  assert.equal(await selection.isChecked(), false);
  assert.equal(await selectedB.isChecked(), true);

  stage = 'open-historical-answer-citation';
  await section('Conversation').click();
  const citation = page.getByRole('button', { name: 'c1 · PDF fixture A', exact: true });
  await citation.waitFor({ state: 'visible' });
  let citationWrites = 0;
  const watch = request => { if (!['GET', 'HEAD'].includes(request.method())) citationWrites++; };
  page.on('request', watch);
  const priorRequests = beforeCitation.requests.length;
  await citation.click();
  stage = 'raster-citation-a-page-3';
  await reader().getByRole('heading', { name: 'PDF fixture A', exact: true }).waitFor();
  assert.equal(await reader().locator('blockquote').textContent(), '实验 A 的标准温度为二十五摄氏度。');
  const citationA3 = await assertRaster(3, 3, true);
  assert.deepEqual(citationA3, manualA3);
  const during = await waitEvidence(member => member.requests.slice(priorRequests).some(row => row.citationTarget === 'a-page-3'));
  assert.deepEqual(during.current, beforeCitation.current);

  stage = 'verify-citation-did-not-write';
  await reader().getByRole('button', { name: 'Close', exact: true }).click();
  await reader().waitFor({ state: 'hidden' });
  await citation.and(page.locator(':focus')).waitFor({ state: 'visible' });
  const final = await evidence();
  assert.equal(citationWrites, 0);
  assert.deepEqual(final.current, beforeCitation.current);
  const citationRequests = final.requests.slice(priorRequests);
  assert.equal(citationRequests.some(row => row.method === 'PATCH'), false);
  assert.equal(citationRequests.filter(row => row.citationTarget === 'a-page-3' && row.status === 200).length, 1);
  assert.equal(citationRequests.filter(row => row.path.endsWith('/version-a/download') && row.status === 200).length, 1);
  assert.equal(reasons.rejectedOrigins.length, 0);
  assert.equal(reasons.errors.length, 0);
  console.log(JSON.stringify({ status: 'pass', chromium: browser.version(), raster: witness, citation: { physicalPage: 3, manualFixedRaster: manualA3, fixedRaster: citationA3, scopeDuring: during.current.source_version_ids, writes: citationWrites }, fixture: final }, null, 2));
} catch {
  let lastEvidence;
  try { lastEvidence = await evidence(AbortSignal.timeout(900)); } catch { /* preserve the probe failure */ }
  // Only known stages, synthetic route labels and status codes escape.
  console.log(JSON.stringify(failureReport(stage, start?.expectedSourceCommit, lastEvidence)));
  process.exitCode = 1;
} finally { await browser?.close(); }
