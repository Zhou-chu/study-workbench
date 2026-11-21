import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderLibrary } from '../../test/library-harness';
import { podcastServer, ep, sp, episode } from '../../test/podcast-fixtures';
import { json } from '../../test/notebook-fixtures';
const d = () => within(screen.getByRole('dialog'));
async function profiles() { await renderLibrary('/podcasts'); fireEvent.click(await screen.findByRole('button', { name: 'Profiles' })); await screen.findByText(ep.name); }
it('create episode profile sends full mandatory schema and explicit nullable/model/language fields', async () => {
    const req = podcastServer();
    await profiles();
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));
    expect(await screen.findByLabelText('Speaker configuration')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'New show' } });
    fireEvent.change(screen.getByLabelText('Speaker configuration'), { target: { value: sp.id } });
    fireEvent.change(screen.getByLabelText('Default briefing'), { target: { value: 'Teach clearly' } });
    fireEvent.change(screen.getByLabelText('Outline model'), { target: { value: 'model:language' } });
    fireEvent.change(screen.getByLabelText('Transcript model'), { target: { value: 'model:language' } });
    await screen.findByRole('option', { name: 'English' });
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'en-US' } });
    fireEvent.change(screen.getByLabelText('Segments'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Max output tokens'), { target: { value: '2048' } });
    fireEvent.click(d().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(req.filter(r => r.method === 'POST' && r.url.endsWith('/episode-profiles'))).toHaveLength(1));
    expect(await req.find(r => r.method === 'POST' && r.url.endsWith('/episode-profiles'))!.clone().json()).toEqual({ name: 'New show', description: '', speaker_config: sp.id, outline_llm: 'model:language', transcript_llm: 'model:language', language: 'en-US', default_briefing: 'Teach clearly', num_segments: 7, max_tokens: 2048 });
});
it('speaker creation, row limits and canceled draft persist without hidden mutation', async () => {
    const req = podcastServer();
    await profiles();
    fireEvent.click(screen.getByRole('button', { name: 'Create speaker' }));
    fireEvent.change(await screen.findByLabelText('Profile name'), { target: { value: 'New hosts' } });
    fireEvent.click(d().getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create speaker' }));
    expect(await screen.findByLabelText('Profile name')).toHaveValue('New hosts');
    expect(req.filter(r => r.method === 'POST')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Voice model'), { target: { value: 'model:voice' } });
    for (let i = 0; i < 3; i++)
        fireEvent.click(d().getByRole('button', { name: 'Add speaker' }));
    expect(d().getByRole('button', { name: 'Add speaker' })).toBeDisabled();
    for (let i = 0; i < 3; i++)
        fireEvent.click(d().getAllByRole('button', { name: 'Remove speaker' }).at(-1)!);
    expect(d().getByRole('button', { name: 'Remove speaker' })).toBeDisabled();
    for (const [label, value] of [['Name', 'Host'], ['Voice ID', 'voice-one'], ['Backstory', 'A teacher'], ['Personality', 'Calm']])
        fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    fireEvent.click(d().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(req.filter(r => r.method === 'POST' && r.url.endsWith('/speaker-profiles'))).toHaveLength(1));
    expect((await req.find(r => r.method === 'POST' && r.url.endsWith('/speaker-profiles'))!.clone().json()).speakers).toEqual([{ name: 'Host', voice_id: 'voice-one', backstory: 'A teacher', personality: 'Calm', voice_model: null }]);
});
it.each([['Episode profiles', 'episode-profiles', ep.id], ['Speaker profiles', 'speaker-profiles', sp.id]])('duplicates %s by exact ID without a body and preserves returned copy identity', async (region, path, id) => {
    const req = podcastServer();
    await profiles();
    fireEvent.click(within(screen.getByRole('region', { name: region })).getByRole('button', { name: 'Duplicate' }));
    fireEvent.click(d().getByRole('button', { name: 'Duplicate' }));
    await d().findByText(path === 'episode-profiles' ? 'episode_profile:copy' : 'speaker_profile:copy');
    const sent = req.filter(r => r.url.endsWith('/duplicate'));
    expect(sent).toHaveLength(1);
    expect(decodeURIComponent(new URL(sent[0]!.url).pathname)).toBe('/api/' + path + '/' + id + '/duplicate');
    expect(await sent[0]!.clone().text()).toBe('');
});
it('episode profile delete cancellation has no effect; confirmed delete captures its actual ID', async () => {
    const req = podcastServer();
    await profiles();
    const region = screen.getByRole('region', { name: 'Episode profiles' });
    fireEvent.click(within(region).getByRole('button', { name: 'Delete' }));
    fireEvent.click(d().getByRole('button', { name: 'Cancel' }));
    expect(req.some(r => r.method === 'DELETE')).toBe(false);
    fireEvent.click(within(region).getByRole('button', { name: 'Delete' }));
    fireEvent.click(d().getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(req.filter(r => r.method === 'DELETE')).toHaveLength(1));
    expect(decodeURIComponent(req.find(r => r.method === 'DELETE')!.url)).toContain('/episode-profiles/' + ep.id);
});
it('speaker delete guards current ID usage again at confirmation, not duplicate names', async () => {
    let used = false;
    const req = podcastServer(r => r.url.endsWith('/episode-profiles') ? json([{ ...ep, speaker_config: used ? sp.id : 'speaker_profile:other', speaker_config_name: sp.name }]) : undefined);
    const h = await renderLibrary('/podcasts');
    fireEvent.click(await screen.findByRole('button', { name: 'Profiles' }));
    const region = screen.getByRole('region', { name: 'Speaker profiles' });
    await within(region).findByText(sp.name);
    await waitFor(() => expect(within(region).getByRole('button', { name: 'Delete' })).toBeEnabled());
    fireEvent.click(within(region).getByRole('button', { name: 'Delete' }));
    used = true;
    await act(async () => h.queries.invalidateQueries({ queryKey: ['library', 'episode-profiles'] }));
    await waitFor(() => expect(d().getByRole('button', { name: 'Delete' })).toBeDisabled());
    expect(req.some(r => r.method === 'DELETE')).toBe(false);
    used = false;
    await act(async () => h.queries.invalidateQueries({ queryKey: ['library', 'episode-profiles'] }));
    await waitFor(() => expect(d().getByRole('button', { name: 'Delete' })).toBeEnabled());
    fireEvent.click(d().getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(req.filter(r => r.method === 'DELETE')).toHaveLength(1));
});
it('missing model setup and refresh errors remain visible without claiming an empty list', async () => {
    let failed = false;
    const req = podcastServer(r => r.url.endsWith('/models') ? json([]) : r.url.endsWith('/podcasts/episodes') && failed ? json({ detail: 'Unavailable' }, 503) : undefined);
    await renderLibrary('/podcasts');
    expect(await screen.findByText('Setup required')).toBeVisible();
    expect(await screen.findByText(episode.name)).toBeVisible();
    failed = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('We could not fetch the latest podcast episodes. Try again shortly.')).toBeVisible();
    expect(screen.getByText(episode.name)).toBeVisible();
    expect(req.filter(r => r.method === 'POST')).toHaveLength(0);
});
it('podcast palette navigation and creation target the working destination without submitting', async () => {
    const req = podcastServer(), h = await renderLibrary('/sources');
    fireEvent.click(await screen.findByRole('button', { name: 'Commands' }));
    fireEvent.click(d().getByRole('button', { name: 'Podcasts' }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe('/podcasts'));
    fireEvent.click(screen.getByRole('button', { name: 'Commands' }));
    fireEvent.click(d().getByRole('button', { name: 'Generate Podcast' }));
    expect(await screen.findByLabelText('Episode name')).toHaveValue('');
    expect(req.filter(r => r.method === 'POST')).toHaveLength(0);
});
it('speaker delete dispatch consults the latest cache even before an observer rerender', async () => {
    const req = podcastServer(r => r.url.endsWith('/episode-profiles') ? json([{ ...ep, speaker_config: 'speaker_profile:other' }]) : undefined), h = await renderLibrary('/podcasts');
    fireEvent.click(await screen.findByRole('button', { name: 'Profiles' }));
    const region = screen.getByRole('region', { name: 'Speaker profiles' });
    await within(region).findByText(sp.name);
    await waitFor(() => expect(within(region).getByRole('button', { name: 'Delete' })).toBeEnabled());
    fireEvent.click(within(region).getByRole('button', { name: 'Delete' }));
    const confirm = d().getByRole('button', { name: 'Delete' });
    act(() => { h.queries.setQueriesData({ queryKey: ['library', 'episode-profiles'] }, [{ ...ep, speaker_config: sp.id }]); fireEvent.click(confirm); });
    await act(async () => { });
    expect(req.filter(r => r.method === 'DELETE')).toHaveLength(0);
});
it('a late action receipt cannot relabel a different open confirmation', async () => {
    let resolve!: (r: Response) => void;
    const req = podcastServer(r => r.url.endsWith('/duplicate') ? new Promise<Response>(yes => resolve = yes) : undefined);
    await profiles();
    fireEvent.click(within(screen.getByRole('region', { name: 'Episode profiles' })).getByRole('button', { name: 'Duplicate' }));
    fireEvent.click(d().getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(resolve).toBeDefined());
    fireEvent.click(d().getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Speaker profiles' })).getByRole('button', { name: 'Duplicate' }));
    await act(async () => resolve(json({ ...ep, id: 'episode_profile:late-copy' })));
    expect(d().queryByText('episode_profile:late-copy')).toBeNull();
    expect(d().getByRole('button', { name: 'Duplicate' })).toBeEnabled();
    expect(req.filter(r => r.url.endsWith('/duplicate'))).toHaveLength(1);
});
it('an uncertain duplicate prevents a same-target profile edit from dispatching', async () => {
    const req = podcastServer(r => r.url.endsWith('/duplicate') ? json({ detail: 'Unknown' }, 503) : undefined);
    await profiles();
    const region = screen.getByRole('region', { name: 'Episode profiles' });
    fireEvent.click(within(region).getByRole('button', { name: 'Duplicate' }));
    fireEvent.click(d().getByRole('button', { name: 'Duplicate' }));
    await d().findByText('Outcome unknown. No automatic retry.');
    fireEvent.click(d().getByRole('button', { name: 'Close' }));
    fireEvent.click(within(region).getByRole('button', { name: 'Edit' }));
    expect(await d().findByRole('button', { name: 'Save' })).toBeDisabled();
    expect(d().getByText('Outcome unknown. No automatic retry.')).toBeVisible();
    expect(d().queryByRole('button', { name: 'New draft' })).toBeNull();
    fireEvent.submit(screen.getByLabelText('Profile name').closest('form')!);
    await act(async () => { });
    expect(req.filter(r => r.method === 'PUT')).toHaveLength(0);
});

it.each([['create', 'unknown'], ['update', 'unknown'], ['create', 'rejected'], ['update', 'rejected']])('I3 %s binding protects its speaker while pending and after %s outcome', async (kind, outcome) => {
    let resolve!: (r: Response) => void;
    const req = podcastServer(r => {
        const path = new URL(r.url).pathname;
        if (r.method === 'GET' && path.endsWith('/episode-profiles')) return json([{ ...ep, speaker_config: 'speaker_profile:other' }]);
        if (path.includes('/episode-profiles') && ['POST', 'PUT'].includes(r.method)) return new Promise<Response>(yes => resolve = yes);
    });
    await profiles();
    const speakers = screen.getByRole('region', { name: 'Speaker profiles' });
    await waitFor(() => expect(within(speakers).getByRole('button', { name: 'Delete' })).toBeEnabled());
    if (kind === 'create') fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));
    else fireEvent.click(within(screen.getByRole('region', { name: 'Episode profiles' })).getByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByLabelText('Profile name'), { target: { value: 'Pending binding' } });
    fireEvent.change(screen.getByLabelText('Default briefing'), { target: { value: 'Teach carefully' } });
    fireEvent.change(screen.getByLabelText('Speaker configuration'), { target: { value: sp.id } });
    fireEvent.click(d().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(resolve).toBeDefined());
    fireEvent.click(d().getByRole('button', { name: 'Close' }));
    expect(within(speakers).getByRole('button', { name: 'Delete' })).toBeDisabled();
    fireEvent.click(within(speakers).getByRole('button', { name: 'Delete' }));
    expect(req.filter(r => r.method === 'DELETE')).toHaveLength(0);
    await act(async () => resolve(outcome === 'unknown' ? json({ malformed: true }) : json({ detail: 'Rejected' }, 422)));
    if (outcome === 'unknown') {
        await screen.findByText('Outcome unknown. No automatic retry.');
        expect(within(speakers).getByRole('button', { name: 'Delete' })).toBeDisabled();
    } else await waitFor(() => expect(within(speakers).getByRole('button', { name: 'Delete' })).toBeEnabled());
    expect(req.filter(r => r.method === 'DELETE')).toHaveLength(0);
});

it.each(['Episode profiles', 'Speaker profiles'])('I4 next %s edit uses the matching acknowledged fields without reverting or losing prior evidence', async region => {
    const isEpisode = region === 'Episode profiles';
    const req = podcastServer(async r => {
        if (r.method === 'PUT') return json({ ...(isEpisode ? ep : sp), ...await r.clone().json(), name: 'Acknowledged B', description: 'Server baseline', ...(isEpisode ? { max_tokens: 3072, num_segments: 7 } : {}) });
    });
    const h = await renderLibrary('/podcasts');
    fireEvent.click(await screen.findByRole('button', { name: 'Profiles' }));
    fireEvent.click(await within(screen.getByRole('region', { name: region })).findByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByLabelText('Profile name'), { target: { value: 'B' } });
    fireEvent.click(d().getByRole('button', { name: 'Save' }));
    fireEvent.click(await d().findByRole('button', { name: 'New draft' }));
    expect(screen.getByLabelText('Profile name')).toHaveValue('Acknowledged B');
    expect(screen.getByLabelText('Description')).toHaveValue('Server baseline');
    if (isEpisode) {
        expect(screen.getByLabelText('Max output tokens')).toHaveValue(3072);
        expect(screen.getByLabelText('Segments')).toHaveValue(7);
    }
    const old = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'podcast-operation')!;
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Second edit' } });
    await act(async () => h.queries.invalidateQueries({ queryKey: ['library', isEpisode ? 'episode-profiles' : 'speaker-profiles'] }));
    expect(screen.getByLabelText('Description')).toHaveValue('Second edit');
    fireEvent.click(d().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(req.filter(r => r.method === 'PUT')).toHaveLength(2));
    const sent = await req.filter(r => r.method === 'PUT')[1]!.clone().json();
    expect(sent).toMatchObject({ name: 'Acknowledged B', description: 'Second edit', ...(isEpisode ? { max_tokens: 3072, num_segments: 7, speaker_config: sp.id, language: null } : { speakers: sp.speakers, voice_model: sp.voice_model }) });
    expect(h.workbench.drafts.library.get(old.id)?.input).toBe(old.input);
    expect(h.workbench.drafts.library.get(old.id)?.token).toBe(old.token);
});
it('I4 successful profile creation still opens a blank create intent rather than an edit or duplicate', async () => {
    const req = podcastServer(); await profiles();
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));
    fireEvent.change(await screen.findByLabelText('Profile name'), { target: { value: 'Created format' } });
    fireEvent.change(screen.getByLabelText('Speaker configuration'), { target: { value: sp.id } });
    fireEvent.change(screen.getByLabelText('Default briefing'), { target: { value: 'Explain' } });
    fireEvent.click(d().getByRole('button', { name: 'Save' }));
    fireEvent.click(await d().findByRole('button', { name: 'New draft' }));
    expect(screen.getByLabelText('Profile name')).toHaveValue('');
    expect(screen.getByLabelText('Speaker configuration')).toHaveValue('');
    expect(req.filter(r => r.method === 'POST')).toHaveLength(1);
    expect(req.filter(r => r.method === 'PUT')).toHaveLength(0);
});

it.each(['Close', 'Cancel'])('I5 palette create reopens its retained form after %s at the same URL without submission', async close => {
    const req = podcastServer(), h = await renderLibrary('/podcasts');
    fireEvent.click(await screen.findByRole('button', { name: 'Commands' }));
    fireEvent.click(d().getByRole('button', { name: 'Generate Podcast' }));
    fireEvent.change(await screen.findByLabelText('Episode name'), { target: { value: 'Retained palette draft' } });
    const old = h.workbench.drafts.library.getSnapshot().find(r => r.input.kind === 'podcast-form')!;
    const firstKey = h.router.state.location.key;
    fireEvent.click(d().getByRole('button', { name: close }));
    fireEvent.click(screen.getByRole('button', { name: 'Commands' }));
    fireEvent.click(d().getByRole('button', { name: 'Generate Podcast' }));
    expect(await screen.findByLabelText('Episode name')).toHaveValue('Retained palette draft');
    expect(h.router.state.location.search).toBe('?create=1');
    expect(h.router.state.location.key).not.toBe(firstKey);
    expect(h.workbench.drafts.library.getSnapshot().filter(r => r.input.kind === 'podcast-form')).toHaveLength(1);
    expect(h.workbench.drafts.library.get(old.id)?.input).toBe(old.input);
    expect(req.filter(r => r.method === 'POST')).toHaveLength(0);
});

it('I1/I4 completed same-owner edit can start another ACK-based edit after temporary readiness loss', async () => {
    const req = podcastServer(), h = await renderLibrary('/podcasts');
    fireEvent.click(await screen.findByRole('button', { name: 'Profiles' }));
    fireEvent.click(await within(screen.getByRole('region', { name: 'Episode profiles' })).findByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByLabelText('Profile name'), { target: { value: 'Saved B' } });
    fireEvent.click(d().getByRole('button', { name: 'Save' }));
    await d().findByRole('button', { name: 'New draft' });
    const epoch = readTurnContext()!.epoch;
    act(() => sessionCoordinator.report('unavailable', sessionCoordinator.current()));
    await act(async () => h.workbench.controller.check());
    expect(readTurnContext()!.epoch).toBe(epoch);
    fireEvent.click(await d().findByRole('button', { name: 'New draft' }));
    expect(screen.getByLabelText('Profile name')).toHaveValue('Saved B');
    expect(screen.getByLabelText('Profile name')).toBeEnabled();
    await waitFor(() => expect(d().getByRole('button', { name: 'Save' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Second same-owner edit' } });
    fireEvent.click(d().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(req.filter(r => r.method === 'PUT')).toHaveLength(2));
    expect(await req.filter(r => r.method === 'PUT')[1]!.clone().json()).toMatchObject({ name: 'Saved B', description: 'Second same-owner edit' });
});
