import { readFileSync } from 'node:fs';
import { fireEvent, screen, waitFor, within, act } from '@testing-library/react';
import { expect, it } from 'vitest';
import { classicServer, nativeSession, nativeMessages, classicNote } from '../../test/classic-fixtures';
import { renderLibrary } from '../../test/library-harness';
import { json } from '../../test/notebook-fixtures';
import { recordReferences } from './RecordReference';
import { nativeMessages as labels } from '../../i18n/native-messages';
import { languages } from '../../i18n';
import { sourceDetail, insight, legacySource, libraryWorkspace } from '../../test/library-fixtures';
it('opens full typed source, note and insight alias references through supported reads, with detached notes read-only', async () => {
    const content = '[source:alpha:full] [note:one:full] [insight:first:full] source:bad/path unknown:attachment';
    const requests = classicServer(r => decodeURIComponent(r.url).endsWith('/chat/sessions/' + nativeSession.id) ? json({ ...nativeSession, messages: [{ ...nativeMessages[1], content }] }) : undefined);
    await renderLibrary('/notebooks/n');
    fireEvent.click(await screen.findByRole('button', { name: 'Classic conversation' }));
    for (const [id, text] of [['source:alpha:full', sourceDetail.full_text!], ['note:one:full', classicNote.content], ['source_insight:first:full', insight.content]] as const) {
        fireEvent.click(await screen.findByRole('button', { name: 'Open reference · ' + id }));
        const dialog = screen.getByRole('dialog');
        await within(dialog).findByText(text);
        if (id.startsWith('note:'))
            expect(within(dialog).queryByRole('button', { name: /save|edit/i })).not.toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    }
    expect(requests.some(r => decodeURIComponent(r.url).includes('/insights/source_insight:first:full'))).toBe(true);
    expect(requests.some(r => r.url.includes('bad'))).toBe(false);
});
it('invalid or missing reference identity remains unavailable instead of trusting a foreign record', async () => {
    const requests = classicServer(r => { const p = decodeURIComponent(r.url); if (p.endsWith('/chat/sessions/' + nativeSession.id))
        return json({ ...nativeSession, messages: [{ ...nativeMessages[1], content: 'note:one:full' }] }); if (p.endsWith('/notes/' + classicNote.id))
        return json({ ...classicNote, id: 'note:foreign' }); });
    await renderLibrary('/notebooks/n');
    fireEvent.click(await screen.findByRole('button', { name: 'Classic conversation' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open reference · note:one:full' }));
    await within(screen.getByRole('dialog')).findByRole('alert');
    expect(screen.queryByText('Note text')).not.toBeInTheDocument();
    expect(requests.some(r => r.method !== 'GET' && r.url.includes('/notes/'))).toBe(false);
});
it('imported legacy history displays role, type, unknown identity and time without adopting or replaying its native-looking ID', async () => {
    const workspace = libraryWorkspace();
    workspace.legacy_history = [{ chat_session_id: 'chat_session:imported', notebook_id: null, history_origin: 'restored', messages: [{ role: 'researcher', type: 'unknown', id: null, timestamp: null, content: 'Imported evidence [source:alpha:full]' }, { content: { projection_status: 'unknown' } }], restored_history: true, replay_allowed: true }];
    const requests = classicServer(undefined, () => json(workspace));
    await renderLibrary('/notebooks/n');
    fireEvent.click(await screen.findByRole('button', { name: 'Classic conversation' }));
    const history = await screen.findByRole('region', { name: 'Read-only imported history' });
    expect(within(history).getByText(/researcher.*unknown.*Unknown/)).toBeVisible();
    expect(within(history).getByText('chat_session:imported', { exact: false })).toBeVisible();
    fireEvent.click(within(history).getByRole('button', { name: 'Open reference · source:alpha:full' }));
    await within(screen.getByRole('dialog')).findByText(sourceDetail.full_text!);
    expect(requests.some(r => r.url.includes('imported'))).toBe(false);
    expect(requests.some(r => r.url.endsWith('/chat/execute'))).toBe(false);
});
it('retains independent explicit bulk IDs after refresh, newly discovered rows stay off, and hides stale context previews', async () => {
    let more = false;
    const later = { ...legacySource, id: 'source:later', title: 'Later source' };
    const requests = classicServer(r => new URL(r.url).pathname === '/api/sources' ? json(more ? [legacySource, later] : [legacySource]) : undefined);
    await renderLibrary('/notebooks/n');
    fireEvent.click(await screen.findByRole('button', { name: 'Classic conversation' }));
    fireEvent.change(await screen.findByLabelText('All loaded sources'), { target: { value: 'insights' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview classic context' }));
    await waitFor(() => expect(requests.some(r => r.url.endsWith('/chat/context'))).toBe(true));
    more = true;
    fireEvent.click(screen.getByRole('button', { name: 'Sources · Refresh' }));
    const newMode = await screen.findByLabelText('Source context · Later source');
    expect(newMode).toHaveValue('not in');
    expect(screen.getByLabelText('Source context · Historical paper')).toHaveValue('insights');
    fireEvent.change(newMode, { target: { value: 'full content' } });
    expect(screen.queryByText(/"token_count"/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Personal conversation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Classic conversation' }));
    expect(await screen.findByLabelText('Source context · Later source')).toHaveValue('full content');
});
it('unknown AI-note creation locks duplicate and remounted save with no guessed title or adoption', async () => {
    const requests = classicServer(r => { if (decodeURIComponent(r.url).endsWith('/chat/sessions/' + nativeSession.id))
        return json({ ...nativeSession, messages: nativeMessages }); if (r.method === 'POST' && r.url.endsWith('/notes'))
        return new Response('{broken', { headers: { 'content-type': 'application/json' } }); });
    await renderLibrary('/notebooks/n');
    fireEvent.click(await screen.findByRole('button', { name: 'Classic conversation' }));
    const save = await screen.findByRole('button', { name: 'Save message to note' });
    act(() => { fireEvent.click(save); fireEvent.click(save); });
    await waitFor(() => expect(save).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Personal conversation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Classic conversation' }));
    expect(await screen.findByRole('button', { name: 'Save message to note' })).toBeDisabled();
    expect(requests.filter(r => r.method === 'POST' && r.url.endsWith('/notes'))).toHaveLength(1);
});
it('has explicit translated labels in every supported locale and preserves full opaque reference identity', () => {
    for (const { code } of languages) {
        expect(Object.keys(labels[code]).sort()).toEqual(Object.keys(labels['en-US']).sort());
        expect(Object.values(labels[code]).every(v => v.trim())).toBe(true);
    }
    expect(recordReferences('[source:multi:with-hyphen] insight:a:b, source:bad/path source:bad%2fpath https://x/source:bad')).toEqual([{ kind: 'source', id: 'source:multi:with-hyphen' }, { kind: 'source_insight', id: 'source_insight:a:b' }]);
});
it('only an explicitly inspected notebook association grants source-message note save, never a return URL', async () => {
    const requests = classicServer(r => decodeURIComponent(r.url).endsWith('/chat/sessions/chat_session:source:full') ? json({ id: 'chat_session:source:full', source_id: 'source:alpha:full', title: 'Source one', created: '2026-11-08', updated: '2026-11-08', messages: nativeMessages }) : undefined);
    const h = await renderLibrary('/notebooks/n');
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect source · Historical paper' }));
    fireEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: 'Chat with source' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save message to note' }));
    await waitFor(() => expect(requests.some(r => r.method === 'POST' && r.url.endsWith('/notes'))).toBe(true));
    expect(await requests.find(r => r.method === 'POST' && r.url.endsWith('/notes'))!.clone().json()).toEqual({ content: 'Whole answer', note_type: 'ai', notebook_id: 'n' });
    await act(async () => h.router.navigate('/sources/source%3Aalpha%3Afull', { state: { sourceOrigin: '/notebooks/n', openSourceChat: true, sourceNotebookGrant: 'untrusted' } }));
    expect(screen.queryByRole('button', { name: 'Save message to note' })).not.toBeInTheDocument();
});
it('native controls retain explicit labels, 44px control targets and monochrome tokens', async () => {
    classicServer();
    await renderLibrary('/notebooks/n');
    fireEvent.click(await screen.findByRole('button', { name: 'Classic conversation' }));
    expect(await screen.findByLabelText('Classic message')).toHaveAccessibleName('Classic message');
    expect(screen.getByLabelText('Conversation model')).toHaveAccessibleName('Conversation model');
    const css = readFileSync('src/app/styles.css', 'utf8');
    expect(css).toMatch(/\.native-chat input,[^}]+min-height: 44px;[^}]+min-width: 44px;/s);
    expect(css).toMatch(/\.native-chat input,[^}]+color: var\(--text\);[^}]+background: var\(--surface\);/s);
});
