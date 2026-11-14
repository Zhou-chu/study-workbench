import { fireEvent, screen, within, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderLibrary } from '../../test/library-harness';
import { json } from '../../test/notebook-fixtures';
import { configurationServer, credentialFixture } from '../../test/configuration-fixtures';
import { supportedProviders } from '../../data/configuration-contracts';
const registry = [{"name": "openai", "display_name": "openai", "modalities": ["language", "embedding", "speech_to_text", "text_to_speech"], "docs_url": "https://platform.openai.com/api-keys", "env_configured": false}, {"name": "anthropic", "display_name": "anthropic", "modalities": ["language"], "docs_url": "https://console.anthropic.com/settings/keys", "env_configured": false}, {"name": "google", "display_name": "google", "modalities": ["language", "embedding", "speech_to_text", "text_to_speech"], "docs_url": "https://aistudio.google.com/app/apikey", "env_configured": false}, {"name": "groq", "display_name": "groq", "modalities": ["language", "speech_to_text"], "docs_url": "https://console.groq.com/keys", "env_configured": false}, {"name": "mistral", "display_name": "mistral", "modalities": ["language", "embedding", "speech_to_text", "text_to_speech"], "docs_url": "https://console.mistral.ai/api-keys/", "env_configured": false}, {"name": "deepseek", "display_name": "deepseek", "modalities": ["language"], "docs_url": "https://platform.deepseek.com/api_keys", "env_configured": false}, {"name": "xai", "display_name": "xai", "modalities": ["language", "text_to_speech"], "docs_url": "https://console.x.ai/", "env_configured": false}, {"name": "openrouter", "display_name": "openrouter", "modalities": ["language", "embedding", "speech_to_text", "text_to_speech"], "docs_url": "https://openrouter.ai/keys", "env_configured": false}, {"name": "dashscope", "display_name": "dashscope", "modalities": ["language"], "docs_url": "https://help.aliyun.com/zh/model-studio/getting-started/", "env_configured": false}, {"name": "minimax", "display_name": "minimax", "modalities": ["language", "text_to_speech"], "docs_url": "https://platform.minimaxi.com/document/Guides", "env_configured": false}, {"name": "novita", "display_name": "novita", "modalities": ["language"], "docs_url": "https://novita.ai/settings/key-management", "env_configured": false}, {"name": "siliconflow", "display_name": "siliconflow", "modalities": ["language"], "docs_url": "https://cloud.siliconflow.com/account/ak", "env_configured": false}, {"name": "zai", "display_name": "zai", "modalities": ["language"], "docs_url": "https://z.ai/manage-apikey/apikey-list", "env_configured": false}, {"name": "ppq", "display_name": "ppq", "modalities": ["language", "embedding", "speech_to_text", "text_to_speech"], "docs_url": "https://ppq.ai", "env_configured": false}, {"name": "cohere", "display_name": "cohere", "modalities": ["language", "embedding"], "docs_url": "https://dashboard.cohere.com/api-keys", "env_configured": false}, {"name": "voyage", "display_name": "voyage", "modalities": ["embedding"], "docs_url": "https://dash.voyageai.com/api-keys", "env_configured": false}, {"name": "elevenlabs", "display_name": "elevenlabs", "modalities": ["text_to_speech", "speech_to_text"], "docs_url": "https://elevenlabs.io/app/settings/api-keys", "env_configured": false}, {"name": "deepgram", "display_name": "deepgram", "modalities": ["text_to_speech", "speech_to_text"], "docs_url": "https://console.deepgram.com/", "env_configured": false}, {"name": "ollama", "display_name": "ollama", "modalities": ["language", "embedding"], "docs_url": null, "env_configured": false}, {"name": "omlx", "display_name": "omlx", "modalities": ["language", "embedding"], "docs_url": "https://github.com/lfnovo/open-notebook/blob/main/docs/5-CONFIGURATION/omlx.md", "env_configured": false}, {"name": "azure", "display_name": "azure", "modalities": ["language", "embedding", "speech_to_text", "text_to_speech"], "docs_url": "https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI", "env_configured": false}, {"name": "vertex", "display_name": "vertex", "modalities": ["language", "embedding", "text_to_speech"], "docs_url": "https://cloud.google.com/vertex-ai/docs/start/cloud-environment", "env_configured": false}, {"name": "openai_compatible", "display_name": "openai_compatible", "modalities": ["language", "embedding", "speech_to_text", "text_to_speech"], "docs_url": "https://github.com/lfnovo/open-notebook/blob/main/docs/5-CONFIGURATION/openai-compatible.md", "env_configured": false}, {"name": "anthropic_compatible", "display_name": "anthropic_compatible", "modalities": ["language"], "docs_url": "https://github.com/lfnovo/open-notebook/blob/main/docs/5-CONFIGURATION/ai-providers.md", "env_configured": false}];
const dialog = () => within(screen.getByRole('dialog'));
it.each(['models', 'models/defaults'])('allows new credentials independently of failed %s metadata', async endpoint => {
  const requests = configurationServer(r => {
    if (new URL(r.url).pathname === '/api/' + endpoint) return json({ detail: 'Synthetic failure' }, 503);
    if (r.method === 'POST' && new URL(r.url).pathname === '/api/credentials') return json({ ...credentialFixture, id: 'credential:synthetic-created' });
    return undefined;
  });
  const h = await renderLibrary('/settings/models');
  await waitFor(() => expect(h.workbench.drafts.configuration.getSnapshot().find(r => r.kind === 'models')?.sources[endpoint === 'models' ? 'models' : 'defaults']?.phase).toBe('error'));
  expect(screen.getByRole('button', { name: 'Add Configuration: OpenAI' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Delete First configuration' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Auto-assign Defaults' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Add Configuration: OpenAI' }));
  expect(dialog().getByLabelText('Name')).toBeEnabled();
  fireEvent.change(dialog().getByLabelText('Name'), { target: { value: 'Synthetic independent' } });
  fireEvent.change(dialog().getByLabelText('API Key'), { target: { value: 'synthetic-independent-key' } });
  fireEvent.click(dialog().getByRole('button', { name: 'Save configuration' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(1);
  expect(requests.filter(r => r.method !== 'GET')[0]!.method).toBe('POST');
});
it('explains missing provider fields and retains unsent private input', async () => {
  const requests = configurationServer(r => new URL(r.url).pathname === '/api/providers' ? json([{ name: 'vertex', display_name: 'Vertex', modalities: ['language'], docs_url: null, env_configured: false }]) : undefined);
  const h = await renderLibrary('/settings/models');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add Configuration: Vertex' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Add Configuration: Vertex' }));
  fireEvent.change(dialog().getByLabelText('Name'), { target: { value: 'Synthetic Vertex' } });
  const key = dialog().getByLabelText('API Key');
  fireEvent.change(key, { target: { value: 'synthetic-unsent-private-key' } });
  fireEvent.click(dialog().getByRole('button', { name: 'Save configuration' }));
  expect(await dialog().findByRole('alert')).toHaveTextContent(/Project/i);
  expect(dialog().getByRole('alert')).toHaveFocus();
  expect(key).toHaveValue('synthetic-unsent-private-key');
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
  expect(JSON.stringify(h.workbench.drafts.configuration.getSnapshot())).not.toContain('synthetic-unsent-private-key');
  fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }));
  expect(key).toHaveValue('');
});

it.each(supportedProviders.flatMap(provider => ['success', 'error'].map(outcome => ({ provider, outcome }))))(
  'opens and saves $provider with controlled $outcome response', async ({ provider, outcome }) => {
    let payload: Record<string, unknown> | undefined;
    const spec = registry.find(p => p.name === provider)!;
    const requests = configurationServer(async r => {
      const path = new URL(r.url).pathname;
      if (path === '/api/providers') return json([spec]);
      if (path === '/api/credentials' && r.method === 'GET') return json([]);
      if (path === '/api/credentials' && r.method === 'POST') {
        payload = await r.json();
        return outcome === 'error' ? json({ detail: 'synthetic-server-private-error' }, 422) :
          json({ ...credentialFixture, id: 'credential:synthetic-created', name: 'Synthetic configuration', provider, modalities: spec.modalities, model_count: 0 });
      }
      return undefined;
    });
    const h = await renderLibrary('/settings/models');
    const add = await screen.findByRole('button', { name: 'Add Configuration: ' + provider });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    fireEvent.change(dialog().getByLabelText('Name'), { target: { value: 'Synthetic configuration' } });
    const key = dialog().getByLabelText('API Key');
    fireEvent.change(key, { target: { value: 'synthetic-provider-key' } });
    if (provider === 'vertex') {
      fireEvent.change(dialog().getByLabelText('GCP Project ID'), { target: { value: 'synthetic-project' } });
      fireEvent.change(dialog().getByLabelText('Region'), { target: { value: 'synthetic-region' } });
    }
    if (provider === 'anthropic_compatible') {
      fireEvent.change(dialog().getByLabelText('Base URL'), { target: { value: 'set' } });
      fireEvent.change(dialog().getByLabelText('Set replacement: Base URL'), { target: { value: 'https://synthetic.invalid' } });
    }
    fireEvent.click(dialog().getByRole('button', { name: 'Save configuration' }));
    await waitFor(() => expect(payload?.provider).toBe(provider));
    expect(payload?.modalities).toEqual(spec.modalities);
    await waitFor(() => expect(key).toHaveValue(''));
    expect(requests.filter(r => r.method !== 'GET')).toHaveLength(1);
    expect(requests.filter(r => r.method !== 'GET')[0]!.url).toMatch(/\/api\/credentials$/);
    if (outcome === 'success') expect(screen.queryByRole('dialog')).toBeNull();
    else {
      expect(dialog().getByRole('alert')).toHaveTextContent('could not be confirmed');
      expect(screen.queryByText('synthetic-server-private-error')).toBeNull();
      expect(dialog().getByRole('button', { name: 'Save configuration' })).toBeDisabled();
    }
    expect(JSON.stringify(h.workbench.drafts.configuration.getSnapshot())).not.toMatch(/synthetic-provider-key|synthetic-server-private-error/);
    expect(JSON.stringify(h.queries.getQueryCache().getAll().map(q => q.state.data))).not.toContain('synthetic-provider-key');
  }
);
it.each(['credentials', 'setup', 'encryption'])('does not create when required %s is unavailable', async source => {
  const requests = configurationServer(r => {
    const path = new URL(r.url).pathname;
    if (source === 'credentials' && path === '/api/credentials') return json({}, 503);
    if (source === 'setup' && path === '/api/credentials/status') return json({}, 503);
    if (source === 'encryption' && path === '/api/credentials/status') return json({ configured: {}, source: {}, encryption_configured: false });
    return undefined;
  });
  await renderLibrary('/settings/models');
  const add = await screen.findByRole('button', { name: 'Add Configuration: OpenAI' });
  expect(add).toBeDisabled();
  fireEvent.click(add);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});

it.each([
  { provider: 'openai', field: 'API Key', mode: 'key' },
  { provider: 'anthropic_compatible', field: 'Base URL', mode: 'base' },
  { provider: 'ollama', field: 'Context Window (num_ctx)', mode: 'context' },
  { provider: 'openai', field: 'Select at least one model type.', mode: 'modalities' },
  { provider: 'openai', field: 'Base URL', mode: 'url' }
])('explains invalid $mode before sending any request', async ({ provider, field, mode }) => {
  const spec = registry.find(p => p.name === provider)!;
  const requests = configurationServer(r => new URL(r.url).pathname === '/api/providers' ? json([spec]) : undefined);
  const h = await renderLibrary('/settings/models');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add Configuration: ' + provider })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Add Configuration: ' + provider }));
  fireEvent.change(dialog().getByLabelText('Name'), { target: { value: 'Synthetic invalid configuration' } });
  const key = dialog().getByLabelText('API Key');
  if (mode !== 'key') fireEvent.change(key, { target: { value: 'synthetic-preserved-input' } });
  if (mode === 'context') fireEvent.change(dialog().getByLabelText(field), { target: { value: '-1' } });
  if (mode === 'modalities') for (const checkbox of dialog().getAllByRole('checkbox')) fireEvent.click(checkbox);
  if (mode === 'url') {
    fireEvent.change(dialog().getByLabelText('Base URL'), { target: { value: 'set' } });
    fireEvent.change(dialog().getByLabelText('Set replacement: Base URL'), { target: { value: 'invalid-url' } });
  }
  fireEvent.click(dialog().getByRole('button', { name: 'Save configuration' }));
  expect(dialog().getByRole('alert')).toHaveTextContent(field);
  expect(key).toHaveValue(mode === 'key' ? '' : 'synthetic-preserved-input');
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
  expect(h.workbench.drafts.configuration.getSnapshot().find(r => r.kind === 'models')?.attempt).toBeNull();
});
it('identifies the failed prerequisite and retries without provider actions', async () => {
  let reads = 0;
  const requests = configurationServer(r => {
    if (new URL(r.url).pathname === '/api/credentials' && ++reads === 1) return json({}, 503);
    return undefined;
  });
  await renderLibrary('/settings/models');
  expect(await screen.findByText('Could not load: saved configurations')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Add Configuration: OpenAI' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading settings' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add Configuration: OpenAI' })).toBeEnabled());
  expect(requests.filter(r => r.method !== 'GET')).toHaveLength(0);
});
