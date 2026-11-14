import { fireEvent, screen, within, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { libraryServer, renderLibrary } from '../../test/library-harness';
import { json } from '../../test/notebook-fixtures';
import { sourceWorkspace } from '../../test/source-fixtures';
import { contentSettings, configuredModels, modelDefaults, credentialFixture } from '../../test/configuration-fixtures';

// Real mounted routes/controllers, synthetic transport only. No provider or live service calls.
it.each(['cancel', 'save', 'failure'] as const)('returns from Tools model setup after %s with question and chosen sources intact', async outcome => {
  const workspace = sourceWorkspace();
  const requests = libraryServer(async request => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/selection') && request.method === 'PATCH') {
      workspace.selection = { ...workspace.selection, ...await request.clone().json() };
      return json(workspace.selection);
    }
    if (path === '/api/credentials/status') return json({ configured: {}, source: {}, encryption_configured: true });
    if (path === '/api/providers') return json([{ name: 'openai', display_name: 'OpenAI', modalities: ['language'], docs_url: null, env_configured: false }]);
    if (path === '/api/credentials' && request.method === 'POST') return outcome === 'failure' ? json({detail:'Synthetic rejected request'},422) : json({...credentialFixture,id:'credential:new',name:'Journey config'});
    if (path === '/api/credentials') return json([]);
    if (path === '/api/credentials/env-status') return json({});
    if (path === '/api/models') return json(configuredModels);
    if (path === '/api/models/defaults') return json(modelDefaults);
    if (path === '/api/settings') return json(contentSettings);
    return undefined;
  }, () => json(workspace));
  const h = await renderLibrary('/notebooks/n?tab=conversation#composer');
  const question = await screen.findByRole('textbox', { name: 'Question' });
  fireEvent.change(question, { target: { value: 'Keep this question through configuration' } });
  fireEvent.click(within(screen.getByRole('region', { name: 'Sources' })).getByRole('button', { name: 'Current question scope' }));
  const choices = screen.getAllByRole('checkbox');
  expect(choices).toHaveLength(2);
  expect(choices[0]).toBeChecked();
  fireEvent.click(choices[1]!);
  await waitFor(() => expect(choices[1]).toBeChecked());
  await waitFor(() => expect(requests.some(r => r.method === 'PATCH')).toBe(true));
  fireEvent.click(screen.getByText('Tools', { selector: 'summary' }));
  const tools = document.querySelector('.notebook-menu') as HTMLElement;
  fireEvent.click(within(tools).getByRole('button', { name: 'Settings' }));
  fireEvent.click(within(tools).getByRole('link', { name: 'Models' }));
  const leaveDraft = await screen.findByRole('dialog', { name: 'Leave this draft?' });
  fireEvent.click(within(leaveDraft).getByRole('button', { name: 'Keep editing' }));
  expect(question).toHaveValue('Keep this question through configuration');
  fireEvent.click(within(tools).getByRole('link', { name: 'Models' }));
  const leaveAgain = await screen.findByRole('dialog', { name: 'Leave this draft?' });
  fireEvent.click(within(leaveAgain).getByRole('button', { name: 'Leave without saving' }));
  await screen.findByRole('heading', { name: 'Models', level: 1 });
  const back = screen.getByRole('link', { name: 'Back' });
  expect(back).toHaveAttribute('href', '/notebooks/n?tab=conversation#composer');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add Configuration: OpenAI' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Add Configuration: OpenAI' }));
  const form = within(screen.getByRole('dialog'));
  fireEvent.change(form.getByLabelText('Name'), { target: { value: 'Journey config' } });
  fireEvent.change(form.getByLabelText('API Key'), { target: { value: 'synthetic-only-key' } });
  if (outcome === 'cancel') fireEvent.click(form.getByRole('button', { name: 'Cancel' }));
  else {
    fireEvent.click(form.getByRole('button', { name: 'Save configuration' }));
    if (outcome === 'failure') {
      await form.findByRole('alert');
      fireEvent.click(form.getByRole('button', { name: 'Cancel' }));
    } else await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  }
  fireEvent.click(back);
  if (outcome === 'failure') fireEvent.click(await screen.findByRole('button', { name: 'Keep work and continue' }));
  const returned = await screen.findByRole('textbox', { name: 'Question' });
  expect(returned).toHaveValue('Keep this question through configuration');
  expect(h.router.state.location.pathname + h.router.state.location.search + h.router.state.location.hash).toBe('/notebooks/n?tab=conversation#composer');
  fireEvent.click(within(screen.getByRole('region', { name: 'Sources' })).getByRole('button', { name: 'Current question scope' }));
  for (const choice of screen.getAllByRole('checkbox')) expect(choice).toBeChecked();
  expect(requests.filter(r => r.method === 'POST')).toHaveLength(outcome === 'cancel' ? 0 : 1);
  expect(requests.some(r => /discover|\/test|\/turns/.test(new URL(r.url).pathname) && r.method === 'POST')).toBe(false);
});
