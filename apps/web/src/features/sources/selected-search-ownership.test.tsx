import { useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { sourceServer, renderSourceFeature } from '../../test/source-harness';
import { sourceContext, sourceWorkspace, selection } from '../../test/source-fixtures';
import { json } from '../../test/notebook-fixtures';
import { SelectedSourceSearch } from './SelectedSourceSearch';

const workspace = sourceWorkspace();
beforeEach(sourceContext);
const response = (quote: string) => json({ hits: [{ evidence_id: quote, source_version_id: 'v-old', quote, locator: {} }] });
function fixture(onRead = vi.fn()) {
  let client!: QueryClient;
  function Parent() {
    const [scope, setScope] = useState(0);
    client = useQueryClient();
    // Real useQuery creates the replacement cache entry during render, as NotebookPage does.
    useQuery({ queryKey: ['workspace', scope, 'n'], enabled: false, queryFn: async () => workspace });
    return <><button onClick={() => setScope(value => value + 1)}>Replace workspace scope</button>
      <SelectedSourceSearch notebookId="n" selection={selection} workspace={workspace} disabled={false} onRead={onRead} /></>;
  }
  return { element: <Parent />, onRead, get client() { return client; } };
}
function search(term: string) {
  fireEvent.change(screen.getByLabelText('Search selected local sources'), { target: { value: term } });
  fireEvent.click(screen.getByRole('button', { name: 'Search extracted text' }));
}
function updateWarnings(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.filter(args => args.some(value => typeof value === 'string' && value.includes('Cannot update a component')));
}
it('retires results when a parent render creates a workspace query without updating a child during render', async () => {
  const errors = vi.spyOn(console, 'error'); // Keep original diagnostics visible.
  sourceServer(() => response('old result'));
  const f = fixture(); await renderSourceFeature(f.element);
  search('old'); await screen.findByText('old result');
  fireEvent.click(screen.getByRole('button', { name: 'Replace workspace scope' }));
  await waitFor(() => expect(screen.queryByText('old result')).not.toBeInTheDocument());
  expect(updateWarnings(errors)).toEqual([]);
});
it('invalidates reading synchronously before deferred React cleanup can run', async () => {
  sourceServer(() => response('old result'));
  const f = fixture(); await renderSourceFeature(f.element);
  search('old'); await screen.findByText('old result');
  const read = screen.getByRole('button', { name: 'Read 1' });
  await act(async () => {
    f.client.getQueryCache().build(f.client, { queryKey: ['workspace', 'new scope', 'n'] });
    read.click();
  });
  expect(f.onRead).not.toHaveBeenCalled();
  expect(screen.queryByText('old result')).not.toBeInTheDocument();
});
it('rejects an old pending response while allowing the next explicit query to succeed', async () => {
  let finish!: (value: Response) => void;
  let searches = 0;
  sourceServer(() => ++searches === 1 ? new Promise(resolve => { finish = resolve; }) : response('new result'));
  const f = fixture(); await renderSourceFeature(f.element);
  search('old'); await waitFor(() => expect(finish).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: 'Replace workspace scope' }));
  await act(async () => finish(response('obsolete')));
  expect(screen.queryByText('obsolete')).not.toBeInTheDocument();
  search('new'); expect(await screen.findByText('new result')).toBeVisible();
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText('new result')).toBeVisible();
});
it('does not publish queued cleanup or a pending response after unmount', async () => {
  const errors = vi.spyOn(console, 'error');
  let finish!: (value: Response) => void;
  sourceServer(() => new Promise(resolve => { finish = resolve; }));
  const f = fixture(); const h = await renderSourceFeature(f.element);
  search('old'); await waitFor(() => expect(finish).toBeDefined());
  await act(async () => {
    f.client.getQueryCache().build(f.client, { queryKey: ['workspace', 'new scope', 'n'] });
    h.unmount();
    finish(response('obsolete'));
  });
  expect(screen.queryByText('obsolete')).not.toBeInTheDocument();
  expect(updateWarnings(errors)).toEqual([]);
});

it('a delayed cleanup cannot erase a newer successful search', async () => {
  let count = 0;
  sourceServer(() => response(++count === 1 ? 'old result' : 'new result'));
  const f = fixture(); await renderSourceFeature(f.element);
  search('old'); await screen.findByText('old result');
  const queued: VoidFunction[] = [];
  // Hold only this cache event's scheduling boundary, not the API or ownership logic.
  const schedule = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(callback => { queued.push(callback); });
  try {
    f.client.getQueryCache().build(f.client, { queryKey: ['workspace', 'deferred cleanup', 'n'] });
  } finally { schedule.mockRestore(); }
  expect(queued).toHaveLength(1);
  search('new'); await screen.findByText('new result');
  await act(async () => { queued.forEach(callback => callback()); });
  expect(screen.getByText('new result')).toBeVisible();
});
