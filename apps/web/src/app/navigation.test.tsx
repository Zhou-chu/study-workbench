import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider, useNavigate } from 'react-router';
import { createEditor, reduceEditor } from '@study/domain';
import { createDraftRegistry, createNavigationController } from './drafts';
import { AppProviders } from './providers';
import { UnsavedNavigationDialog, RouterNavigationGuard } from './UnsavedNavigationDialog';
const id = { epoch: 1, notebookId: 'A', editorSession: 'editor-1' };
const draft = () => createEditor('A', { title: 'Title', content: 'Unsaved', citations: [] });
it('separates notebook/editor sessions and retires epochs without losing retained File identity', () => {
    const registry = createDraftRegistry();
    const file = new File(['x'], 'x.txt');
    registry.update(id, { editor: draft(), file, question: 'q' });
    registry.update({ ...id, notebookId: 'B' }, { editor: createEditor('B', { title: '', content: 'B', citations: [] }) });
    expect(registry.get(id)?.file).toBe(file);
    expect(registry.get({ ...id, editorSession: 'other' })).toBeUndefined();
    registry.retireContext(1);
    expect(registry.get(id)?.retired).toBe(true);
    registry.update(id, { question: 'changed' });
    expect(registry.get(id)?.question).toBe('q');
});
it.each(['saving', 'unknown', 'conflict', 'rejected'] as const)('blocks %s saves from generic discard or late not-sent', state => {
    const registry = createDraftRegistry();
    let editor = reduceEditor(draft(), { type: 'begin-save', operationId: 'original' });
    if (state !== 'saving')
        editor = reduceEditor(editor, state === 'conflict' ? { type: 'save-conflict', operationId: 'original', status: 409 } : { type: state === 'unknown' ? 'save-unknown' : 'save-rejected', operationId: 'original' });
    if (state !== 'saving')
        editor = reduceEditor(editor, { type: 'save-not-sent', operationId: 'original' });
    registry.update(id, { editor });
    const nav = createNavigationController(registry);
    nav.activate(id);
    expect(nav.requestNavigation({ destination: '/notebooks/B' })).toBe('blocked');
    expect(nav.confirm()).toBeNull();
    expect(registry.get(id)?.editor?.pending?.operationId).toBe('original');
});
it('binds confirmations to original editor revision and retires A to B to A', () => {
    const registry = createDraftRegistry();
    registry.update(id, { editor: draft() });
    const nav = createNavigationController(registry);
    nav.activate(id);
    expect(nav.requestNavigation({ destination: '/B' })).toBe('confirm');
    nav.activate({ ...id, editorSession: 'second' });
    nav.activate(id);
    expect(nav.confirm()).toBeNull();
    nav.requestNavigation({ destination: '/B' });
    registry.update(id, { editor: reduceEditor(draft(), { type: 'edit', content: 'new' }) });
    expect(nav.confirm()).toBeNull();
    expect(registry.get(id)?.editor?.content).toBe('new');
});
it('cancel restores opener; beforeunload only warns and never clears or saves', async () => {
    const registry = createDraftRegistry();
    registry.update(id, { editor: draft() });
    const nav = createNavigationController(registry);
    nav.activate(id);
    function View() { return <><button onClick={event => nav.requestNavigation({ destination: '/B', opener: event.currentTarget })}>Leave</button><UnsavedNavigationDialog navigation={nav}/></>; }
    render(<AppProviders locale="en-US"><View /></AppProviders>);
    const opener = screen.getByText('Leave');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(opener).toHaveFocus());
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(registry.get(id)?.editor?.content).toBe('Unsaved');
});
it('intercepts real router Back, cancels without changing page, and handles confirmed navigation once', async () => {
    const registry = createDraftRegistry();
    registry.update(id, { editor: draft() });
    const nav = createNavigationController(registry);
    nav.activate(id);
    function View() { const navigate = useNavigate(); return <><button onClick={() => navigate(-1)}>Back</button><RouterNavigationGuard navigation={nav}/><UnsavedNavigationDialog navigation={nav}/></>; }
    const router = createMemoryRouter([{ path: '*', element: <AppProviders locale="en-US"><View /></AppProviders> }], { initialEntries: ['/B', '/A'], initialIndex: 1 });
    render(<RouterProvider router={router}/>);
    fireEvent.click(screen.getByText('Back'));
    expect(await screen.findByRole('dialog')).toBeVisible();
    fireEvent.click(screen.getByText('Keep editing'));
    expect(router.state.location.pathname).toBe('/A');
    fireEvent.click(screen.getByText('Back'));
    fireEvent.click(screen.getByText('Leave without saving'));
    await act(async () => { });
    expect(router.state.location.pathname).toBe('/B');
});
it('ignores a delayed confirmation from a retired dialog even after a new confirmation exists', () => {
    const registry = createDraftRegistry();
    registry.update(id, { editor: draft() });
    const nav = createNavigationController(registry);
    nav.activate(id);
    nav.requestNavigation({ destination: '/old' });
    const old = nav.getSnapshot().capture;
    nav.activate({ ...id, editorSession: 'other' });
    nav.activate(id);
    nav.requestNavigation({ destination: '/new' });
    expect(nav.confirm(old)).toBeNull();
    expect(nav.getSnapshot().capture?.intent.destination).toBe('/new');
});
it('guards Forward and rejects confirmation if the draft changed while the dialog was open', async () => {
    const registry = createDraftRegistry();
    registry.update(id, { editor: draft() });
    const nav = createNavigationController(registry);
    nav.activate(id);
    function View() { const navigate = useNavigate(); return <><button onClick={() => navigate(1)}>Forward</button><RouterNavigationGuard navigation={nav}/><UnsavedNavigationDialog navigation={nav}/></>; }
    const router = createMemoryRouter([{ path: '*', element: <AppProviders locale="en-US"><View /></AppProviders> }], { initialEntries: ['/A', '/B'], initialIndex: 0 });
    render(<RouterProvider router={router}/>);
    fireEvent.click(screen.getByText('Forward'));
    await screen.findByRole('dialog');
    registry.update(id, { editor: reduceEditor(draft(), { type: 'edit', content: 'newer' }) });
    fireEvent.click(screen.getByText('Leave without saving'));
    await act(async () => { });
    expect(router.state.location.pathname).toBe('/A');
    expect(registry.get(id)?.editor?.content).toBe('newer');
});
it('exposes retired context even when no draft was ever created', () => {
    const registry = createDraftRegistry();
    expect(registry.get(id)).toBeUndefined();
    registry.retireContext(id.epoch);
    expect(registry.isRetired(id)).toBe(true);
    registry.update(id, { question: 'late write' });
    expect(registry.get(id)).toBeUndefined();
    const next = { ...id, epoch: 2, editorSession: 'new-explicit-editor' };
    registry.update(next, { question: 'new work' });
    expect(registry.isRetired(next)).toBe(false);
    expect(registry.get(next)?.question).toBe('new work');
});
