import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { renderLibrary } from '../../test/library-harness';
import { json } from '../../test/notebook-fixtures';
import { configurationServer, credentialFixture, configuredModels, modelDefaults } from '../../test/configuration-fixtures';

const deepseek = { ...credentialFixture, id: 'credential:deepseek-new', name: 'New DeepSeek configuration', provider: 'deepseek', modalities: ['language'], model_count: 0 };
const providers = [
  { name: 'openai', display_name: 'OpenAI', modalities: ['language', 'embedding'], docs_url: null, env_configured: true },
  { name: 'deepseek', display_name: 'DeepSeek', modalities: ['language'], docs_url: null, env_configured: false }
];
const guide = () => screen.getByRole('region', { name: 'Model setup' });
const value = (label: string) => within(guide()).getByText(label, { selector: 'dt' }).nextElementSibling!;
const article = (name: string) => within(screen.getByRole('heading', { name, level: 3 }).closest('article')!);
const accept = () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm action' }));
async function ready() {
  const h = await renderLibrary('/settings/models');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Auto-assign Defaults' })).toBeEnabled());
  return h;
}
function server(handler?: Parameters<typeof configurationServer>[0]) {
  return configurationServer(async r => {
    const custom = await handler?.(r);
    if (custom) return custom;
    if (new URL(r.url).pathname === '/api/providers') return json(providers);
    if (new URL(r.url).pathname === '/api/credentials') return json([credentialFixture, deepseek]);
    return undefined;
  });
}

// Fails if saving a key is conflated with registration, current default selection or a provider test.
it('shows the next step after a DeepSeek save while preserving an existing other-provider chat default', async () => {
  let saved = false;
  const requests = server(r => {
    if (new URL(r.url).pathname !== '/api/credentials') return undefined;
    if (r.method === 'GET') return json(saved ? [credentialFixture, deepseek] : [credentialFixture]);
    saved = true;
    return json(deepseek);
  });
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Add Configuration: DeepSeek' }));
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Name'), { target: { value: deepseek.name } });
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('API Key'), { target: { value: 'synthetic-journey-secret' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save configuration' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await screen.findByRole('heading', { name: deepseek.name });
  expect(value('Saved configurations')).toHaveTextContent('2');
  expect(value('Registered models')).toHaveTextContent('3');
  expect(value('Current global chat default')).toHaveTextContent('OpenAI · Chat fixture');
  expect(within(guide()).getByText(/Saving another configuration.*do not replace/)).toBeVisible();
  expect(article(deepseek.name).getByText(/No registered models are linked/)).toBeVisible();
  expect(article(deepseek.name).getByRole('button', { name: 'Discover Models ' + deepseek.name })).toBeEnabled();
  expect(value('External validation')).toHaveTextContent(/No current test result/);
  expect(screen.getByLabelText(/^Chat Model/)).toHaveValue('model:chat');
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(1);
  expect(document.body.textContent).not.toMatch(/synthetic-journey-secret|synthetic-hidden|private.invalid|synthetic\/private/);
});

// Fails if guidance bypasses the existing capture/confirmation flow.
it('uses the existing explicit discovery and registration flow without selecting a default', async () => {
  const requests = server(r => new URL(r.url).pathname.endsWith('/discover')
    ? json({ credential_id: deepseek.id, provider: 'deepseek', discovered: [{ name: 'deepseek-chat', provider: 'deepseek', model_type: 'language' }] })
    : new URL(r.url).pathname.endsWith('/register-models') ? json({ created: 1, existing: 0 }) : undefined);
  await ready();
  expect(article(deepseek.name).getByText(/No registered models are linked/)).toBeVisible();
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
  fireEvent.click(article(deepseek.name).getByRole('button', { name: 'Discover Models ' + deepseek.name }));
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
  accept();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'deepseek-chat' }));
  fireEvent.click(screen.getByRole('button', { name: 'Register selected' }));
  await waitFor(() => expect(requests.filter(r => r.method !== 'GET')).toHaveLength(2));
  expect(requests.filter(r => r.method !== 'GET').map(r => decodeURIComponent(new URL(r.url).pathname)))
    .toEqual(['/api/credentials/credential:deepseek-new/discover', '/api/credentials/credential:deepseek-new/register-models']);
  expect(screen.getByLabelText(/^Chat Model/)).toHaveValue('model:chat');
});

it('shows exact linked configuration names and separates unbound, missing and mismatched references', async () => {
  const old = { ...deepseek, id: 'credential:deepseek-old', name: 'Older DeepSeek configuration', model_count: 1 };
  server(r => new URL(r.url).pathname === '/api/credentials' ? json([credentialFixture, deepseek, old])
    : new URL(r.url).pathname === '/api/models' ? json([
      ...configuredModels,
      { ...configuredModels[0], id: 'model:deepseek', provider: 'deepseek', name: 'DeepSeek old binding', credential: old.id },
      { ...configuredModels[0], id: 'model:unbound', name: 'Unbound model', credential: null },
      { ...configuredModels[0], id: 'model:missing', name: 'Missing configuration model', credential: 'credential:missing' },
      { ...configuredModels[0], id: 'model:mismatch', name: 'Mismatched configuration model', credential: old.id }
    ]) : undefined);
  await ready();
  expect(article('DeepSeek old binding').getByText(/Linked configuration:/)).toHaveTextContent(old.name);
  expect(article('DeepSeek old binding').queryByText(deepseek.name)).toBeNull();
  expect(article('Unbound model').getByText(/Linked configuration:/)).toHaveTextContent(/Not bound/);
  expect(article('Missing configuration model').getByText(/Linked configuration:/)).toHaveTextContent(/Unknown/);
  expect(article('Mismatched configuration model').getByText(/Linked configuration:/)).toHaveTextContent(/Unknown/);
});

it.each([
  ['credentials', 'Saved configurations'], ['models', 'Registered models'], ['models/defaults', 'Current global chat default']
])('reports failed %s metadata as unknown rather than zero or unset', async (endpoint, label) => {
  server(r => new URL(r.url).pathname === '/api/' + endpoint ? json({}, 503) : undefined);
  await renderLibrary('/settings/models');
  await screen.findByText(new RegExp('Could not load: ' + (endpoint === 'credentials' ? 'saved configurations' : endpoint === 'models' ? 'registered models' : 'default model assignments')));
  expect(value(label)).toHaveTextContent(/Unknown/);
  expect(value(label)).not.toHaveTextContent(/^0$|Not selected/);
  if (endpoint !== 'models/defaults') expect(screen.queryByText(/No registered models are linked/)).toBeNull();
});

it('keeps loading metadata unknown even when earlier lists remain in memory', async () => {
  const h = await readyWithServer();
  const row = h.workbench.drafts.configuration.getSnapshot().find(r => r.kind === 'models')!;
  act(() => {
    h.workbench.drafts.configuration.loading(row.id, 'models');
    h.workbench.drafts.configuration.loading(row.id, 'credentials');
  });
  expect(value('Saved configurations')).toHaveTextContent(/Loading/);
  expect(value('Registered models')).toHaveTextContent(/Loading/);
  expect(value('Current global chat default')).toHaveTextContent(/Loading/);
  expect(article('Chat fixture').getByText(/Linked configuration:/)).toHaveTextContent(/Unknown/);
  expect(screen.queryByText(/No registered models are linked/)).toBeNull();
});
async function readyWithServer() { server(); return ready(); }

it('does not label a missing default model as selected or ready', async () => {
  server(r => new URL(r.url).pathname === '/api/models/defaults' ? json({ ...modelDefaults, default_chat_model: 'model:missing' }) : undefined);
  await ready();
  expect(value('Current global chat default')).toHaveTextContent(/Unknown/);
  expect(value('Current global chat default')).not.toHaveTextContent('model:missing');
});

it('reports an explicitly empty configuration without calling any provider', async () => {
  const requests = server(r => {
    const path = new URL(r.url).pathname;
    if (path === '/api/credentials' || path === '/api/models') return json([]);
    if (path === '/api/models/defaults') return json({ ...modelDefaults, default_chat_model: null });
    return undefined;
  });
  await ready();
  expect(value('Saved configurations')).toHaveTextContent(/^0$/);
  expect(value('Registered models')).toHaveTextContent(/^0$/);
  expect(value('Current global chat default')).toHaveTextContent(/Not selected/);
  expect(value('External validation')).toHaveTextContent(/No current test result/);
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});

it('does not infer zero linked models when credential and model counts disagree', async () => {
  server(r => new URL(r.url).pathname === '/api/credentials' ? json([credentialFixture, { ...deepseek, model_count: 1 }]) : undefined);
  await ready();
  expect(article(deepseek.name).getByText(/model links.*unknown/i)).toBeVisible();
  expect(article(deepseek.name).queryByText(/No registered models are linked/)).toBeNull();
});

it.each([
  ['Test Connection First configuration', 'Connection check', true, 'Check result received'],
  ['Test Model Chat fixture', 'Model check', true, 'Check result received'],
  ['Test Model Chat fixture', 'Model check', false, 'Check reported failure']
] as const)('reflects the explicit %s result without claiming a notebook task used it', async (button, kind, success, result) => {
  const requests = server(r => new URL(r.url).pathname.endsWith('/test') ? json({ success, message: 'synthetic-private-message', details: 'synthetic-private-details' }) : undefined);
  await ready();
  expect(value('External validation')).toHaveTextContent(/No current test result/);
  fireEvent.click(screen.getByRole('button', { name: button }));
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
  accept();
  await waitFor(() => expect(value('External validation')).toHaveTextContent(result));
  expect(value('External validation')).toHaveTextContent(kind + ':');
  expect(value('External validation')).toHaveTextContent(result);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
  fireEvent.click(within(guide()).getByText('How to check whether setup took effect'));
  expect(within(guide()).getByText(/does not prove.*notebook task/)).toBeVisible();
  expect(document.body.textContent).not.toMatch(/synthetic-private-message|synthetic-private-details/);
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(1);
});

it('marks a previous successful check as stale after metadata is refreshed', async () => {
  server(r => new URL(r.url).pathname.endsWith('/test') ? json({ success: true, message: 'Synthetic check', details: null }) : undefined);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Test Model Chat fixture' }));
  accept();
  await waitFor(() => expect(value('External validation')).toHaveTextContent(/Check result received/));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Auto-assign Defaults' })).toBeEnabled());
  expect(value('External validation')).toHaveTextContent(/Previous check/);
});

it('does not show retained metadata as the current configuration after retirement', async () => {
  const h = await readyWithServer();
  act(() => h.workbench.drafts.retireContext(readTurnContext()!.epoch));
  expect(value('Saved configurations')).toHaveTextContent(/Unknown/);
  expect(value('Current global chat default')).toHaveTextContent(/Unknown/);
  expect(screen.queryByText(/No registered models are linked/)).toBeNull();
});

it('hides current claims while session readiness is suspended even if metadata was previously ready', async () => {
  await readyWithServer();
  act(() => sessionCoordinator.report('reauth-required', sessionCoordinator.current()));
  await screen.findByLabelText('Password');
  fireEvent.click(screen.getByRole('button', { name: 'Close reauthentication' }));
  expect(value('Current global chat default')).toHaveTextContent(/Unknown/);
  expect(value('Saved configurations')).toHaveTextContent(/Unknown/);
  expect(article('Chat fixture').getByText(/Linked configuration:/)).toHaveTextContent(/Unknown/);
  expect(screen.queryByText(/No registered models are linked/)).toBeNull();
});

it('does not carry a successful model check onto a different chat default', async () => {
  let selected = 'model:chat';
  server(r => {
    const path = new URL(r.url).pathname;
    if (path.endsWith('/test')) return json({ success: true, message: 'Synthetic check', details: null });
    if (path === '/api/models') return json([...configuredModels, { ...configuredModels[0], id: 'model:deepseek', name: 'deepseek-chat', provider: 'deepseek', credential: deepseek.id }]);
    if (path === '/api/models/defaults') {
      if (r.method === 'PUT') selected = 'model:deepseek';
      return json({ ...modelDefaults, default_chat_model: selected });
    }
    return undefined;
  });
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Test Model Chat fixture' }));
  accept();
  await waitFor(() => expect(value('External validation')).toHaveTextContent(/Chat fixture.*Check result received/));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
  fireEvent.change(screen.getByLabelText(/^Chat Model/), { target: { value: 'model:deepseek' } });
  accept();
  await waitFor(() => expect(value('Current global chat default')).toHaveTextContent('DeepSeek · deepseek-chat'));
  expect(value('External validation')).toHaveTextContent(/No current test result/);
  expect(value('External validation')).not.toHaveTextContent('Check result received');
});

it('keeps a test of a non-default model distinct from the selected chat model', async () => {
  server(r => new URL(r.url).pathname.endsWith('/test') ? json({ success: true, message: 'Synthetic check', details: null }) : undefined);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Test Model Next embedding' }));
  accept();
  await waitFor(() => expect(value('External validation')).toHaveTextContent(/Next embedding.*Check result received/));
  expect(value('Current global chat default')).toHaveTextContent('OpenAI · Chat fixture');
  expect(value('External validation')).not.toHaveTextContent('Chat fixture');
});

it('shows the setup journey and linked configuration in Chinese after switching language', async () => {
  await readyWithServer();
  fireEvent.click(screen.getByRole('button', { name: 'Appearance and language' }));
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'zh-CN' } });
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  const translated = screen.getByRole('region', { name: '模型配置进度' });
  expect(within(translated).getByText('当前全局聊天默认模型')).toBeVisible();
  fireEvent.click(within(translated).getByText('如何判断配置生效'));
  expect(within(translated).getByText(/不代表某次笔记本任务/)).toBeVisible();
  expect(article(deepseek.name).getByText(/配置已保存.*发现模型/)).toBeVisible();
  expect(article('Chat fixture').getByText(/关联配置/)).toHaveTextContent('First configuration');
});

it.each([
  { provider: 'voyage', type: 'embedding', purpose: 'document search' },
  { provider: 'elevenlabs', type: 'text_to_speech', purpose: 'audio generation' },
  { provider: 'deepgram', type: 'speech_to_text', purpose: 'speech transcription' }
])('guides $provider registration toward its supported task instead of a chat default', async ({ provider, type, purpose }) => {
  server(r => {
    const path = new URL(r.url).pathname;
    if (path === '/api/providers') return json([{ name: provider, display_name: provider, modalities: [type], docs_url: null, env_configured: false }]);
    if (path === '/api/credentials') return json([{ ...deepseek, provider, modalities: [type], name: 'Task configuration' }]);
    return undefined;
  });
  await ready();
  const next = article('Task configuration').getByText(/No registered models are linked/);
  expect(next).toHaveTextContent(/matching task/);
  expect(next).toHaveTextContent(purpose);
  expect(next).not.toHaveTextContent(/chat default/);
});

it('keeps the chat default unknown after an uncertain defaults write without replaying it', async () => {
  const requests = server(r => {
    const path = new URL(r.url).pathname;
    if (path === '/api/models') return json([...configuredModels, { ...configuredModels[0], id: 'model:new-chat', name: 'Another chat' }]);
    if (path === '/api/models/defaults' && r.method === 'PUT') return json({}, 503);
    return undefined;
  });
  await ready();
  fireEvent.change(screen.getByLabelText(/^Chat Model/), { target: { value: 'model:new-chat' } });
  accept();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Auto-assign Defaults' })).toBeDisabled());
  expect(value('Current global chat default')).toHaveTextContent(/Unknown/);
  expect(value('Current global chat default')).not.toHaveTextContent('Chat fixture');
  expect(within(guide()).getAllByRole('link')[0]).toHaveTextContent('Review configuration status');
  expect(requests.filter(r => r.method === 'PUT')).toHaveLength(1);
});

it('marks a successful check as previous evidence when its configuration record is retired', async () => {
  server(r => new URL(r.url).pathname.endsWith('/test') ? json({ success: true, message: 'Synthetic check', details: null }) : undefined);
  const h = await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Test Model Chat fixture' }));
  accept();
  await waitFor(() => expect(value('External validation')).toHaveTextContent(/Check result received/));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
  act(() => h.workbench.drafts.retireContext(readTurnContext()!.epoch));
  expect(value('External validation')).toHaveTextContent(/Previous check/);
  expect(value('External validation')).not.toHaveTextContent('Check result received');
  expect(value('Current global chat default')).toHaveTextContent(/Unknown/);
});

it.each([
  { button: 'Test Model Chat fixture', details: null },
  { button: 'Test Model Chat fixture', details: 'synthetic-private-rate-limit-details' },
  { button: 'Test Connection First configuration', details: null },
  { button: 'Test Connection First configuration', details: 'synthetic-private-rate-limit-details' }
])('does not turn a successful check boolean into model invocation proof for $button ($details)', async ({ button, details }) => {
  const requests = server(r => new URL(r.url).pathname.endsWith('/test')
    ? json({ success: true, message: 'Rate limited - but connection works', details }) : undefined);
  const h = await ready();
  fireEvent.click(screen.getByRole('button', { name: button }));
  accept();
  await waitFor(() => expect(value('External validation')).toHaveTextContent('Check result received'));
  expect(value('External validation')).toHaveTextContent('a model response is not confirmed');
  expect(value('External validation')).not.toHaveTextContent(/Passed/);
  const result = within(screen.getByRole('dialog'));
  expect(result.getByRole('heading')).toHaveTextContent('Check result received');
  expect(result.queryByText('Unknown', { exact: true })).toBeNull();
  expect(result.queryByText('None', { exact: true })).toBeNull();
  expect(result.getByText(/rate limits.*model response is not confirmed/)).toBeVisible();
  expect(document.body.textContent).not.toMatch(/Rate limited - but connection works|synthetic-private-rate-limit-details/);
  const attempt = h.workbench.drafts.configuration.getSnapshot().find(r => r.kind === 'models')!.attempt!;
  expect(attempt.result).toEqual({ success: true, details_present: details !== null });
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(1);
});

it('puts next actions before optional explanations and keeps capability facts visible without provider calls', async () => {
  const requests = server();
  await ready();
  const help = within(guide()).getByText('How to check whether setup took effect');
  const details = help.closest('details')!;
  expect(details).not.toHaveAttribute('open');
  expect(within(guide()).getByText(/does not prove that a notebook task/)).not.toBeVisible();
  const next = within(guide()).getAllByRole('link')[0]!;
  expect(next).toBeVisible();
  expect(next.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(value('Current global chat default')).toHaveTextContent('OpenAI · Chat fixture');
  fireEvent.click(help);
  expect(details).toHaveAttribute('open');
  expect(within(guide()).getByText(/does not prove that a notebook task/)).toBeVisible();
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});


// Fails if the primary guide link always sends an unregistered credential to an empty/default selector.
it('leads a newly saved language configuration to its own registration controls before an existing chat default', async () => {
  const requests = server();
  await ready();
  const next = within(guide()).getAllByRole('link')[0]!;
  expect(next).toHaveTextContent('Register models: DeepSeek · ' + deepseek.name);
  const target = document.getElementById(next.getAttribute('href')!.slice(1))!;
  expect(target).toHaveAttribute('tabindex', '-1');
  expect(within(target).getByRole('button', { name: 'Discover Models ' + deepseek.name })).toBeEnabled();
  fireEvent.click(next);
  expect(value('Current global chat default')).toHaveTextContent('OpenAI · Chat fixture');
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});

it('leads an empty setup to the provider area rather than an empty chat default', async () => {
  const requests = server(r => ['/api/credentials', '/api/models'].includes(new URL(r.url).pathname) ? json([]) : undefined);
  await ready();
  const next = within(guide()).getAllByRole('link')[0]!;
  expect(next).toHaveTextContent('Add a chat configuration');
  const target = document.getElementById(next.getAttribute('href')!.slice(1))!;
  expect(target).toHaveAttribute('tabindex', '-1');
  expect(within(target).getByRole('button', { name: 'Add Configuration: DeepSeek' })).toBeEnabled();
  fireEvent.click(next);
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});

it('lists multiple unregistered language configurations without choosing a provider for the user', async () => {
  const other = { ...deepseek, id: 'credential:another', provider: 'openai', name: 'Another pending configuration' };
  const requests = server(r => new URL(r.url).pathname === '/api/credentials' ? json([credentialFixture, deepseek, other]) : undefined);
  await ready();
  const next = within(guide()).getAllByRole('link')[0]!;
  expect(next).toHaveTextContent('Review configurations awaiting registration');
  const target = document.getElementById(next.getAttribute('href')!.slice(1))!;
  expect(target).toHaveAttribute('tabindex', '-1');
  const links = within(target).getAllByRole('link');
  expect(links).toHaveLength(2);
  expect(links.map(link => link.textContent)).toEqual([
    'Register models: DeepSeek · ' + deepseek.name,
    'Register models: OpenAI · ' + other.name
  ]);
  for (const link of links) {
    const credentialArea = document.getElementById(link.getAttribute('href')!.slice(1))!;
    expect(within(credentialArea).getByRole('button', { name: /^Discover Models / })).toBeEnabled();
    fireEvent.click(link);
  }
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});

it.each(['embedding', 'text_to_speech', 'speech_to_text'])('does not let an unregistered %s configuration displace a usable chat path', async modality => {
  const requests = server(r => new URL(r.url).pathname === '/api/credentials'
    ? json([credentialFixture, { ...deepseek, modalities: [modality] }]) : undefined);
  await ready();
  const next = within(guide()).getAllByRole('link')[0]!;
  expect(next).toHaveTextContent('Choose the chat default');
  expect(next).toHaveAttribute('href', '#model-default-assignments');
  fireEvent.click(next);
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});

it('keeps registered environment or unbound language models usable without demanding a saved key', async () => {
  const requests = server(r => new URL(r.url).pathname === '/api/credentials' ? json([])
    : new URL(r.url).pathname === '/api/models' ? json([{ ...configuredModels[0], credential: null }]) : undefined);
  await ready();
  const next = within(guide()).getAllByRole('link')[0]!;
  expect(next).toHaveTextContent('Choose the chat default');
  expect(within(guide()).queryByText('Add a chat configuration')).toBeNull();
  fireEvent.click(next);
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});

it.each(['count mismatch', 'provider mismatch', 'unknown provider', 'decryption problem'])('offers safe status review rather than guessed registration for %s', async problem => {
  const candidate = { ...deepseek, ...(problem === 'count mismatch' ? { model_count: 1 }
    : problem === 'unknown provider' ? { provider: 'unrecognized' }
    : problem === 'decryption problem' ? { decryption_error: 'Synthetic decryption problem' } : {}) };
  const requests = server(r => new URL(r.url).pathname === '/api/credentials' ? json([credentialFixture, candidate])
    : problem === 'provider mismatch' && new URL(r.url).pathname === '/api/models'
      ? json([...configuredModels, { ...configuredModels[0], id: 'model:mismatch', credential: deepseek.id }]) : undefined);
  await ready();
  const next = within(guide()).getAllByRole('link')[0]!;
  expect(next).toHaveTextContent('Review configuration status');
  const target = document.getElementById(next.getAttribute('href')!.slice(1))!;
  expect(target).toHaveAttribute('tabindex', '-1');
  fireEvent.click(next);
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});

it.each(['loading', 'error', 'retired'])('offers only safe navigation while metadata is %s', async state => {
  const requests = server();
  const h = await ready();
  const row = h.workbench.drafts.configuration.getSnapshot().find(r => r.kind === 'models')!;
  act(() => {
    if (state === 'retired') h.workbench.drafts.retireContext(readTurnContext()!.epoch);
    else {
      const revision = h.workbench.drafts.configuration.loading(row.id, 'models')!;
      if (state === 'error') h.workbench.drafts.configuration.publish(row.id, 'models', revision, null);
    }
  });
  const next = within(guide()).getAllByRole('link')[0]!;
  expect(next).toHaveTextContent('Review configuration status');
  fireEvent.click(next);
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});

it('uses safe unique anchor characters without showing raw credential identifiers', async () => {
  const candidate = { ...deepseek, id: 'credential:odd<"é', name: 'Readable configuration' };
  const requests = server(r => new URL(r.url).pathname === '/api/credentials' ? json([credentialFixture, candidate]) : undefined);
  await ready();
  const next = within(guide()).getAllByRole('link')[0]!;
  expect(next).toHaveTextContent('Register models: DeepSeek · Readable configuration');
  expect(next.getAttribute('href')).toMatch(/^#model-setup-credential-[a-f0-9]+$/);
  expect(document.getElementById(next.getAttribute('href')!.slice(1))).toHaveTextContent(candidate.name);
  expect(guide()).not.toHaveTextContent(candidate.id);
  fireEvent.click(next);
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});


it('does not treat a dangling language model credential reference as an environment model', async () => {
  const requests = server(r => new URL(r.url).pathname === '/api/credentials' ? json([])
    : new URL(r.url).pathname === '/api/models' ? json([{ ...configuredModels[0], credential: 'credential:missing' }]) : undefined);
  await ready();
  expect(within(guide()).getAllByRole('link')[0]).toHaveAttribute('href', '#model-setup-status');
  expect(article('Chat fixture').getByText(/Linked configuration:/)).toHaveTextContent('Unknown');
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});

it('leads an empty setup without encryption to the blocker instead of a disabled Add control', async () => {
  const requests = server(r => {
    const path = new URL(r.url).pathname;
    if (path === '/api/credentials' || path === '/api/models') return json([]);
    if (path === '/api/credentials/status') return json({ configured: {}, source: {}, encryption_configured: false });
    return undefined;
  });
  await ready();
  expect(screen.getByRole('button', { name: 'Add Configuration: OpenAI' })).toBeDisabled();
  const next = within(guide()).getAllByRole('link')[0]!;
  expect(next).toHaveAttribute('href', '#model-setup-status');
  const target = document.getElementById(next.getAttribute('href')!.slice(1))!;
  expect(within(target).getByRole('alert')).toBeVisible();
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});

it('does not require encryption for a null-bound environment language model default', async () => {
  const requests = server(r => {
    const path = new URL(r.url).pathname;
    if (path === '/api/credentials') return json([]);
    if (path === '/api/models') return json([{ ...configuredModels[0], credential: null }]);
    if (path === '/api/credentials/status') return json({ configured: { openai: true }, source: { openai: 'environment' }, encryption_configured: false });
    return undefined;
  });
  await ready();
  expect(within(guide()).getAllByRole('link')[0]).toHaveAttribute('href', '#model-default-assignments');
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});

it('offers registration on a saved multipurpose credential when only an embedding model is registered globally', async () => {
  const requests = server(r => new URL(r.url).pathname === '/api/credentials' ? json([{ ...credentialFixture, model_count: 1 }])
    : new URL(r.url).pathname === '/api/models' ? json([configuredModels[1]]) : undefined);
  await ready();
  const next = within(guide()).getAllByRole('link')[0]!;
  expect(next).toHaveTextContent('Register models: OpenAI · ' + credentialFixture.name);
  expect(within(document.getElementById(next.getAttribute('href')!.slice(1))!)
    .getByRole('button', { name: 'Discover Models ' + credentialFixture.name })).toBeEnabled();
  expect(value('Registered models')).toHaveTextContent('1');
  expect(article(credentialFixture.name).queryByText(/No registered models are linked/)).toBeNull();
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});

it('does not demand another chat registration for every multipurpose embedding credential when a usable chat model exists', async () => {
  const second = { ...credentialFixture, id: 'credential:two', name: 'Embedding configuration', model_count: 1 };
  const requests = server(r => new URL(r.url).pathname === '/api/credentials' ? json([credentialFixture, second]) : undefined);
  await ready();
  expect(within(guide()).getAllByRole('link')[0]).toHaveAttribute('href', '#model-default-assignments');
  expect(within(guide()).queryByRole('link', { name: /Register models/ })).toBeNull();
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});
