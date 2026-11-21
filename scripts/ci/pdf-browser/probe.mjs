import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const [origin] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(origin ?? ''))
  throw new Error('Usage: node probe.mjs http://127.0.0.1:<fixture-port>');
const evidenceUrl = origin + '/__fixture_evidence';
const evidence = async () => (await fetch(evidenceUrl)).json();
let start, browser;
let stage = 'fixture-manifest';
try {
  start = await evidence();
  assert.equal(start.artifactKind, 'verified-release-manifests', 'Diagnostic build lacks runtime artifact identity; do not run browser against it');
  assert.equal(start.artifact.source_commit, start.expectedSourceCommit);
  stage = 'chromium-start';
  browser = await chromium.launch({ executablePath: chromium.executablePath(), chromiumSandbox: true, headless: true });
  const reasons = { errors: [], rejectedOrigins: [] };
  stage = 'select-source-a';
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const destination = new URL(route.request().url());
    if (destination.origin === origin || destination.protocol === 'blob:') return route.continue();
    reasons.rejectedOrigins.push(destination.origin);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => reasons.errors.push(error.name));
  await page.goto(origin + '/notebooks/synthetic', { waitUntil: 'domcontentloaded' });
  const titleA = page.getByRole('button', { name: 'PDF fixture A', exact: true });
  const titleB = page.getByRole('button', { name: 'PDF fixture B', exact: true });
  const scope = titleA.locator('xpath=ancestor::li[1]').getByRole('button', { name: 'Current question scope' });
  await scope.click();
  const selection = page.getByRole('checkbox', { name: 'Select PDF fixture A · Version 1' });
  await selection.check();
  await waitEvidence(member => member.current.source_version_ids.join() === 'version-a');
  const witness = [];
  function reader() { return page.getByRole('region', { name: 'Reader', exact: true }); }
  async function assertRaster(num, total) {
    const r = reader();
    await r.getByText('/ ' + total, { exact: true }).waitFor({ state: 'visible' });
    const input = r.getByRole('spinbutton');
    assert.equal(await input.inputValue(), String(num));
    assert.equal(await input.getAttribute('max'), String(total));
    const canvas = r.locator('canvas[data-render-state="ready"][data-page-number="' + num + '"]');
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
    witness.push({ page: num, physicalCount: total, ...raster });
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
  }
  assert.ok(await reader().getByRole('button', { name: 'Next', exact: true }).isDisabled());
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
  console.log(JSON.stringify({ status: 'pass', chromium: browser.version(), raster: witness, fixture: result }, null, 2));
} catch {
  // Only a known stage escapes; automation errors may include local paths or markup.
  console.log(JSON.stringify({ status: 'fail', stage, sourceCommit: start?.expectedSourceCommit ?? null }));
  process.exitCode = 1;
} finally { await browser?.close(); }
