import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { publishTurnTarget, readTurnContext, sessionCoordinator } from '@study/web-transport';
import { renderLibrary } from '../../test/library-harness';
import { podcastServer, ep, episode, legacySource } from '../../test/podcast-fixtures';
import { json } from '../../test/notebook-fixtures';
const d = () => within(screen.getByRole('dialog'));
async function form() { fireEvent.click(await screen.findByRole('button', { name: 'Generate Podcast' })); fireEvent.change(await screen.findByLabelText('Episode name'), { target: { value: 'Lesson' } }); fireEvent.change(screen.getByLabelText('Episode profile'), { target: { value: ep.id } }); fireEvent.click(await screen.findByLabelText('Synthetic notebook')); fireEvent.change(await screen.findByLabelText('Select mode · ' + legacySource.title), { target: { value: 'full content' } }); }
async function ready() { fireEvent.click(screen.getByRole('button', { name: 'Preview context' })); await screen.findByText(/Source material/); }
it('unsubmitted draft survives reauthentication; explicit fresh intent preserves selected IDs but invalidates old preview', async () => {
    const req = podcastServer();
    const h = await renderLibrary('/podcasts');
    await form();
    await ready();
    const original = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'podcast-form')!;
    act(() => sessionCoordinator.report('reauth-required', sessionCoordinator.current()));
    expect(document.querySelector('.library-dialog')).toBeNull();
    await act(async () => h.workbench.controller.login('synthetic'));
    expect(await screen.findByLabelText('Episode name')).toHaveValue('Lesson');
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'New draft' }));
    expect(screen.getByLabelText('Episode name')).toHaveValue('Lesson');
    expect(await screen.findByLabelText('Select mode · ' + legacySource.title)).toHaveValue('full content');
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
    expect(h.workbench.drafts.library.get(original.id)?.input).toBe(original.input);
    expect(req.filter(r => r.url.endsWith('/podcasts/generate'))).toHaveLength(0);
});
it('late preview after selection revision cannot restore stale counts or submit a subset', async () => {
    let resolve!: (r: Response) => void;
    const req = podcastServer(r => r.url.endsWith('/chat/context') ? new Promise<Response>(yes => resolve = yes) : undefined);
    await renderLibrary('/podcasts');
    await form();
    fireEvent.click(screen.getByRole('button', { name: 'Preview context' }));
    await waitFor(() => expect(resolve).toBeDefined());
    fireEvent.change(screen.getByLabelText('Select mode · ' + legacySource.title), { target: { value: 'not in' } });
    await act(async () => resolve(json({ context: { sources: [{ id: legacySource.id, full_text: 'STALE' }], notes: [] }, token_count: 999, char_count: 999 })));
    expect(screen.queryByText(/999 tokens/)).toBeNull();
    expect(screen.queryByText(/STALE/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
    expect(req.filter(r => r.url.endsWith('/podcasts/generate'))).toHaveLength(0);
});
it.each(['foreign', 'duplicate', 'unusable', 'missing-membership'])('fail closed on %s selected context without dispatch', async (variant) => {
    let sourceReads = 0;
    const req = podcastServer(r => {
        if (variant === 'missing-membership' && new URL(r.url).pathname === '/api/sources' && new URL(r.url).searchParams.has('offset') && ++sourceReads > 1)
            return json([]);
        if (r.url.endsWith('/chat/context')) {
            const source = { id: variant === 'foreign' ? 'source:foreign' : legacySource.id, full_text: variant === 'unusable' ? null : 'Body', insights: [{ content: 'Fallback must not be used' }] };
            return json({ context: { sources: variant === 'duplicate' ? [source, source] : [source], notes: [] }, token_count: 3, char_count: 5 });
        }
    });
    await renderLibrary('/podcasts');
    await form();
    fireEvent.click(screen.getByRole('button', { name: 'Preview context' }));
    await screen.findAllByText(/Revise your selection/);
    if (variant === 'missing-membership') expect(screen.queryByText(/Selected content was not returned/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview context' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
    expect(req.filter(r => r.url.endsWith('/podcasts/generate'))).toHaveLength(0);
});
it('generation late receipt after reauth retains original input and never authorizes replay', async () => {
    let resolve!: (r: Response) => void;
    const req = podcastServer(r => r.url.endsWith('/podcasts/generate') ? new Promise<Response>(yes => resolve = yes) : undefined), h = await renderLibrary('/podcasts');
    await form();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(resolve).toBeDefined());
    const original = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'podcast-operation')!;
    act(() => sessionCoordinator.report('reauth-required', sessionCoordinator.current()));
    await act(async () => resolve(json({ job_id: 'command:late', status: 'submitted', message: 'Queued', episode_profile: ep.name, episode_name: 'Lesson' })));
    expect(h.workbench.drafts.library.get(original.id)?.status).toBe('unknown');
    expect(h.workbench.drafts.library.get(original.id)?.input).toBe(original.input);
    expect(h.workbench.drafts.library.get(original.id)?.token).toBe(original.token);
    expect(req.filter(r => r.url.endsWith('/podcasts/generate'))).toHaveLength(1);
});
it('IME submit is suppressed and ordinary edit invalidates previously built content', async () => {
    const req = podcastServer();
    await renderLibrary('/podcasts');
    await form();
    await ready();
    const input = screen.getByLabelText('Episode name');
    fireEvent.compositionStart(input);
    fireEvent.submit(input.closest('form')!);
    expect(req.some(r => r.url.endsWith('/podcasts/generate'))).toBe(false);
    fireEvent.compositionEnd(input);
    fireEvent.change(screen.getByLabelText('Additional instructions'), { target: { value: 'Revision' } });
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
    expect(screen.queryByText(/Source material/)).toBeNull();
});
it('refetched new sources stay off even after explicit bulk selection; classic selection is independent', async () => {
    let added = false;
    const req = podcastServer(r => new URL(r.url).pathname === '/api/sources' ? json(added ? [legacySource, { ...legacySource, id: 'source:new:full', title: 'New item' }] : [legacySource]) : undefined), h = await renderLibrary('/podcasts');
    await form();
    fireEvent.change(screen.getByLabelText('All loaded sources'), { target: { value: 'insights' } });
    added = true;
    await act(async () => h.queries.invalidateQueries({ queryKey: ['library', 'podcast-sources'] }));
    expect(await screen.findByLabelText('Select mode · New item')).toHaveValue('not in');
    const context = readTurnContext()!;
    act(() => { h.workbench.drafts.library.open({ kind: 'notebook', notebookId: 'n' }, { kind: 'classic-context', parent: { kind: 'notebook', notebookId: 'n' }, config: { sources: { 'source:new:full': 'full content' }, notes: {} } }, context, sessionCoordinator.current()); });
    expect(screen.getByLabelText('Select mode · New item')).toHaveValue('not in');
    expect(req.filter(r => r.method === 'POST')).toHaveLength(0);
});
it('malformed mutation acknowledgment remains unknown and blocks same-target delete after an uncertain profile save', async () => {
    const req = podcastServer(r => r.method === 'PUT' ? json({ wrong: 'shape' }) : undefined);
    await renderLibrary('/podcasts');
    fireEvent.click(await screen.findByRole('button', { name: 'Profiles' }));
    const region = screen.getByRole('region', { name: 'Episode profiles' });
    fireEvent.click(await within(region).findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'Uncertain rename' } });
    fireEvent.click(d().getByRole('button', { name: 'Save' }));
    await d().findByText('Outcome unknown. No automatic retry.');
    fireEvent.click(d().getByRole('button', { name: 'Close' }));
    expect(within(region).getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(within(region).getByRole('button', { name: 'Duplicate' })).toBeDisabled();
    expect(req.filter(r => r.method === 'PUT')).toHaveLength(1);
});
it.each(['https://evil.invalid/audio.mp3', '/api/podcasts/episodes/episode:other/audio', '/private/audio.mp3'])('uncontained audio %s is never requested', async (audio_url) => {
    const req = podcastServer(r => r.url.endsWith('/podcasts/episodes') ? json([{ ...episode, audio_url }]) : undefined);
    await renderLibrary('/podcasts');
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
    expect(d().getByRole('button', { name: 'Load audio' })).toBeDisabled();
    expect(d().getByRole('button', { name: 'Download File' })).toBeDisabled();
    expect(req.some(r => r.url.includes('/audio'))).toBe(false);
});
it('explicit audio download uses a safe filename, separate transient object URL and no HEAD', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download'), revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { }), click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe('safe.mp3'); });
    const req = podcastServer(r => r.url.endsWith('/audio') ? new Response(new Blob(['audio']), { headers: { 'content-disposition': 'attachment; filename="../../safe.mp3"' } }) : undefined);
    await renderLibrary('/podcasts');
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
    fireEvent.click(d().getByRole('button', { name: 'Download File' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:download');
    expect(req.filter(r => r.method === 'HEAD')).toHaveLength(0);
});
it('open audio reader cannot fetch under a replacement target', async () => {
    const req = podcastServer();
    await renderLibrary('/podcasts');
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
    const target = readTurnContext()!.target;
    await act(async () => publishTurnTarget({ ...target, apiBase: 'http://localhost:3000/replaced' }, true));
    expect(screen.getByRole('button', { name: 'Load audio' })).toBeDisabled();
    expect(req.filter(r => r.url.endsWith('/audio'))).toHaveLength(0);
});
it('generation checks live profile metadata at the explicit dispatch even before rerender', async () => {
    const req = podcastServer(), h = await renderLibrary('/podcasts');
    await form();
    await ready();
    const send = screen.getByRole('button', { name: 'Generate' });
    act(() => { h.queries.setQueriesData({ queryKey: ['library', 'episode-profiles'] }, [{ ...ep, speaker_config: null }]); fireEvent.click(send); });
    await act(async () => { });
    expect(req.filter(r => r.url.endsWith('/podcasts/generate'))).toHaveLength(0);
});
it('an interrupted preview can be explicitly rebuilt after reauth without an abandoned busy latch', async () => {
    let resolve!: (r: Response) => void;
    const req = podcastServer(r => r.url.endsWith('/chat/context') ? new Promise<Response>(yes => resolve = yes) : undefined), h = await renderLibrary('/podcasts');
    await form();
    fireEvent.click(screen.getByRole('button', { name: 'Preview context' }));
    await waitFor(() => expect(resolve).toBeDefined());
    act(() => sessionCoordinator.report('reauth-required', sessionCoordinator.current()));
    await act(async () => h.workbench.controller.login('synthetic'));
    fireEvent.click(await screen.findByRole('button', { name: 'New draft' }));
    expect(await screen.findByRole('button', { name: 'Preview context' })).toBeEnabled();
    await act(async () => resolve(json({ context: { sources: [], notes: [] }, token_count: 0, char_count: 0 })));
    expect(req.filter(r => r.url.endsWith('/podcasts/generate'))).toHaveLength(0);
});
it('late audio bytes after close are discarded without creating an object URL', async () => {
    let resolve!: (r: Response) => void;
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:late');
    podcastServer(r => r.url.endsWith('/audio') ? new Promise<Response>(yes => resolve = yes) : undefined);
    await renderLibrary('/podcasts');
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
    fireEvent.click(d().getByRole('button', { name: 'Load audio' }));
    await waitFor(() => expect(resolve).toBeDefined());
    fireEvent.click(d().getByRole('button', { name: 'Close' }));
    await act(async () => resolve(new Response(new Blob(['late']))));
    expect(create).not.toHaveBeenCalled();
});
it('only active episode rows poll; unmount stops the owned timer and unknown rows never enqueue', async () => {
    const req = podcastServer(), h = await renderLibrary('/podcasts');
    await screen.findByText(episode.name);
    const query = h.queries.getQueryCache().findAll({ queryKey: ['library', 'podcast-episodes'] })[0]!;
    vi.useFakeTimers();
    try {
        await act(async () => { h.queries.setQueryData(query.queryKey, [{ ...episode, job_status: 'running' }]); await vi.advanceTimersByTimeAsync(1); });
        const before = req.filter(r => r.url.endsWith('/podcasts/episodes')).length;
        await act(async () => { await vi.advanceTimersByTimeAsync(15010); });
        expect(req.filter(r => r.url.endsWith('/podcasts/episodes')).length).toBeGreaterThan(before);
        await act(async () => { h.queries.setQueryData(query.queryKey, [{ ...episode, job_status: 'unknown' }]); await vi.advanceTimersByTimeAsync(1); });
        const unknown = req.filter(r => r.url.endsWith('/podcasts/episodes')).length;
        await act(async () => { await vi.advanceTimersByTimeAsync(30010); });
        expect(req.filter(r => r.url.endsWith('/podcasts/episodes'))).toHaveLength(unknown);
        h.unmount();
        await act(async () => { await vi.advanceTimersByTimeAsync(30010); });
        expect(req.filter(r => r.method === 'POST')).toHaveLength(0);
    }
    finally {
        vi.useRealTimers();
    }
});
it('media decoding errors are localized and unsafe filename-only values fall back safely', async () => {
    let downloaded = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloaded = this.download; });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:media-error');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
    podcastServer(r => r.url.endsWith('/audio') ? new Response(new Blob(['bad-media']), { headers: { 'content-disposition': 'attachment; filename=".."' } }) : undefined);
    await renderLibrary('/podcasts');
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
    fireEvent.click(d().getByRole('button', { name: 'Download File' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(downloaded).not.toMatch(/^[. ]+$|[<>:"|?*\/]/);
    fireEvent.click(d().getByRole('button', { name: 'Load audio' }));
    const media = await screen.findByLabelText('Recorded lesson audio');
    fireEvent.error(media);
    expect(d().getByText('Audio unavailable')).toBeVisible();
});
