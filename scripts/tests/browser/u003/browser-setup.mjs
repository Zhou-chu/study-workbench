/** Actual browser U003 setup rung, admitted only by the owned fixture launcher. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { inspectOrigin } from './release-preflight.mjs';

const name = 'Notebook U003 public fixture';
const labelA = 'fixture_a.pdf';
const labelB = 'fixture_b.pdf';
const model = 'acceptance-chat:latest';
const connection = 'U003 local model fixture';
const question = '实验 A 的标准温度是多少？';

export function browserBoundaries(origin, modelOrigin) {
  for (const candidate of [origin, modelOrigin]) {
    const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(candidate);
    if (!match || Number(match[1]) < 1024 || Number(match[1]) > 65535) throw Error('Expected owned loopback origin');
  }
  if (origin === modelOrigin) throw Error('Gateway and fixture provider must be distinct listeners');
  return url => {
    const parsed = new URL(url);
    return parsed.origin === origin && ['http:', 'blob:'].includes(parsed.protocol);
  };
}

export function sourceReceipt(workspace) {
  const byName = (expected) => {
    const source = workspace.sources.find(s => s.title === expected);
    return source?.versions.find(v => v.status === 'ready' && v.original_status === 'available')?.source_version_id;
  };
  const a = byName(labelA), b = byName(labelB);
  return typeof a === 'string' && typeof b === 'string' && a !== b ? { a, b } : null;
}

const role = (parent, roleName, name) => parent.getByRole(roleName, { name, exact: true });
async function enabled(page, locator) {
  const ready = locator.and(page.locator(':enabled'));
  await ready.waitFor({ state: 'visible' });
  return ready;
}

/**
 * The supplied chromium comes from the existing locked Playwright tooling.
 * Performs real user actions only; conditional browser routing blocks outside
 * network but never fulfills, edits, or stubs an application API response.
 */
export async function runModelSetup({ chromium, origin, modelOrigin, target, password, fixtures, checkOwned, onStage }) {
  const allowed = browserBoundaries(origin, modelOrigin);
  const phase = value => onStage?.(value);
  await checkOwned();
  const preflight = await inspectOrigin({ origin, target, password });
  phase('chr-start');
  const browser = await chromium.launch({ executablePath: chromium.executablePath(), chromiumSandbox: true, headless: true });
  try {
    const context = await browser.newContext({
      locale: 'en-US', viewport: { width: 1440, height: 900 }, serviceWorkers: 'block',
    });
    const blocked = [], pageErrors = [];
    await context.route('**/*', route => {
      if (allowed(route.request().url())) return route.continue();
      blocked.push(true);
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    let submitCount = 0;
    page.on('request', req => {
      if (req.method() === 'POST' && /\/api\/personal\/chats\/[^/]+\/turns$/.test(new URL(req.url()).pathname)) submitCount++;
    });
    page.on('pageerror', () => pageErrors.push(true));
    phase('sign-in');
    await page.goto(origin + '/notebooks', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Password', { exact: true }).fill(password);
    await role(page, 'button', 'Sign in').click();
    phase('open-create-notebook');
    await role(page, 'button', 'New Notebook').first().click();
    const editor = role(page, 'dialog', 'Create New Notebook');
    await editor.getByLabel('Name', { exact: true }).fill(name);
    phase('submit-create-notebook');
    const [creation] = await Promise.all([
      page.waitForResponse(r => r.url() === origin + '/api/notebooks' && r.request().method() === 'POST'),
      role(editor, 'button', 'New').click(),
    ]);
    assert.equal(creation.status(), 200);
    const created = await creation.json();
    assert.equal(created.name, name);
    assert.match(created.id, /^notebook:.+/);
    phase('open-created-workspace');
    const notebookPath = '/notebooks/' + encodeURIComponent(created.id);
    await page.waitForURL(origin + notebookPath);
    const section = title => role(role(page, 'navigation', 'Workspace sections'), 'button', title);
    async function readWorkspace(accept) {
      for (let attempt = 0; attempt < 60; attempt++) {
        await checkOwned();
        const response = await page.request.get(origin + '/api/personal' + notebookPath + '/workspace-view', {
          headers: { authorization: 'Bearer ' + password }, timeout: 10_000, maxRedirects: 0,
        });
        assert.equal(response.status(), 200);
        const payload = await response.json();
        await response.dispose();
        const witness = accept(payload);
        if (witness) return witness;
        await new Promise(resolve => setTimeout(resolve, 350));
      }
      throw Error('Workspace did not settle');
    }
    await readWorkspace(w => w.notebook.id === created.id && w.notebook.name === name);
    phase('open-source-upload');
    await section('Sources').click();
    await role(role(page, 'region', 'Sources'), 'button', 'Add sources').click();
    const upload = role(page, 'dialog', 'Add sources');
    phase('choose-source-files');
    // setInputFiles does not wait for actionability; the real picker ignores choices
    // before the authenticated upload capability and byte limit are known.
    const pick = await enabled(page, upload.getByLabel('Choose files', { exact: true }));
    await pick.setInputFiles([path.join(fixtures, labelA), path.join(fixtures, labelB)]);
    phase('prepare-source-files');
    for (const label of [labelA, labelB]) await upload.getByText(label, { exact: true }).waitFor();
    const send = await enabled(page, role(upload, 'button', 'Upload'));
    phase('submit-source-files');
    const statuses = [];
    const endpoint = origin + '/api/personal' + notebookPath + '/sources/upload';
    await Promise.all([
      page.waitForResponse(r => {
        if (r.url() !== endpoint || r.request().method() !== 'POST') return false;
        statuses.push(r.status());
        return statuses.length === 2 || !r.ok();
      }),
      send.click().then(() => phase('source-upload-http')),
    ]);
    assert.deepEqual(statuses, [200, 200]);
    phase('source-extraction-ready');
    const ids = await readWorkspace(sourceReceipt);
    phase('close-source-upload');
    await role(upload, 'button', 'Close').click();

    phase('a-only-draft');
    const source = title => role(page, 'button', title).locator('xpath=ancestor::li[1]');
    const selected = title => role(page, 'checkbox', 'Select ' + title + ' · Version 1');
    await role(source(labelA), 'button', 'Current question scope').click();
    await (await enabled(page, selected(labelA))).check();
    await role(source(labelB), 'button', 'Current question scope').click();
    assert.equal(await selected(labelB).isChecked(), false);
    await readWorkspace(w => JSON.stringify(w.selection.source_version_ids) === JSON.stringify([ids.a]));
    await section('Conversation').click();
    const draft = () => role(page, 'textbox', 'Question');
    const ask = () => role(page, 'button', 'Ask selected sources');
    await draft().fill(question);
    const configure = role(page, 'link', 'Configure independent model');
    await configure.waitFor();
    assert.equal(await ask().isDisabled(), true);
    assert.equal(submitCount, 0);
    phase('setup-entry');
    const start = page.url();
    await configure.click();
    const leave = role(page, 'dialog', 'Leave this draft?');
    await role(leave, 'button', 'Leave without saving').click();
    await role(page, 'heading', 'Models').and(page.locator('h1')).waitFor();
    const setChat = page.getByLabel(/^Chat Model/);
    await enabled(page, setChat);
    assert.equal(await setChat.inputValue(), '');

    phase('save-discover-register');
    await role(page, 'button', 'Add Configuration: Ollama').click();
    const settings = role(page, 'dialog', 'Add Configuration');
    await settings.getByLabel('Name', { exact: true }).fill(connection);
    await settings.getByLabel('Base URL', { exact: true }).selectOption('set');
    await settings.getByRole('textbox', { name: /: Base URL$/ }).fill(modelOrigin);
    await role(settings, 'button', 'Save configuration').click();
    await settings.waitFor({ state: 'hidden' });
    await role(page, 'button', 'Discover Models ' + connection).click();
    const confirm = () => role(page, 'button', 'Confirm action');
    await confirm().click();
    const discovered = role(page, 'checkbox', model);
    await discovered.waitFor();
    await discovered.check();
    const modelType = page.getByRole('combobox', { name: 'Model Type', exact: true });
    await modelType.selectOption('language');
    await role(page, 'button', 'Register selected').click();
    phase('assign-default');
    await page.getByRole('heading', { name: model, exact: true }).waitFor();
    await setChat.selectOption({ label: model });
    await confirm().click();
    await confirm().waitFor({ state: 'hidden' });
    assert.notEqual(await setChat.inputValue(), '');

    phase('return-original-draft');
    await role(page, 'link', 'Back').click();
    await page.waitForURL(start);
    assert.equal(await draft().inputValue(), question);
    await enabled(page, ask());
    await readWorkspace(w => JSON.stringify(w.selection.source_version_ids) === JSON.stringify([ids.a]));
    assert.equal(submitCount, 0);
    assert.deepEqual(blocked, []);
    assert.deepEqual(pageErrors, []);
    return { ...preflight, chromium: browser.version(), status: 'pass', stage: 'setup-and-return',
      selectedSources: 1, preservedDraft: true, browserTurnRequests: 0, citationStatus: 'not-run' };
  } finally {
    await browser.close();
  }
}
