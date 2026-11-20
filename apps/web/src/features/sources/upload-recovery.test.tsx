import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { resources, sourceMessages } from '../../i18n';
import { beforeEach, expect, it } from 'vitest';
import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { sourceContext, receipt } from '../../test/source-fixtures';
import { sourceServer, renderSourceFeature } from '../../test/source-harness';
import { suspendAndRecover } from '../../test/session-recovery';
import { json } from '../../test/notebook-fixtures';
import { AddSourceDialog } from './AddSourceDialog';
import { UploadStatus } from './UploadStatus';

beforeEach(sourceContext);
const choose = (file: File) => fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [file] } });
const upload = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Upload' });
it.each(['same-owner', 'fresh-login'])('explicitly submits the same never-sent File after %s recovery once', async recovery => {
    const requests = sourceServer(() => json(receipt));
    const h = await renderSourceFeature(<AddSourceDialog notebookId="n" open onClose={() => {}} onChanged={() => {}}/>);
    const file = new File(['pdf'], 'same.pdf', { type: 'application/pdf', lastModified: 1 });
    choose(file);
    await waitFor(() => expect(upload()).toBeEnabled());
    const original = h.workbench.drafts.sources.getSnapshot()[0]!;
    expect(original.operation.token).toBeNull();
    if (recovery === 'fresh-login') await act(async () => h.workbench.controller.login('synthetic'));
    else await suspendAndRecover(h.workbench.controller);
    expect(requests.filter(r => r.method === 'POST' && r.url.includes('/sources'))).toHaveLength(0);
    choose(file);
    await waitFor(() => expect(upload()).toBeEnabled());
    fireEvent.click(upload());
    await waitFor(() => expect(requests.filter(r => r.method === 'POST' && r.url.includes('/sources'))).toHaveLength(1));
    const sent = h.workbench.drafts.sources.getSnapshot().find(r => r.operation.state === 'succeeded')!;
    expect(sent).toMatchObject({ file, notebookId: 'n', retired: false });
    if (recovery === 'fresh-login') {
        expect(sent.id).not.toBe(original.id);
        expect(h.workbench.drafts.sources.get(original.id)).toMatchObject({ file, retired: true });
        expect(h.workbench.drafts.sources.begin(original.id, readTurnContext(), sessionCoordinator.current())).toBeNull();
    }
});
it.each(['same-owner', 'fresh-login'])('retains the unknown original key instead of bypassing it after %s recovery', async recovery => {
    const requests = sourceServer(r => r.method === 'POST' ? Promise.reject(new Error('lost ack')) : json({}));
    const h = await renderSourceFeature(<AddSourceDialog notebookId="n" open onClose={() => {}} onChanged={() => {}}/>);
    const file = new File(['pdf'], 'same.pdf', { lastModified: 1 });
    choose(file); await waitFor(() => expect(upload()).toBeEnabled()); fireEvent.click(upload());
    await waitFor(() => expect(h.workbench.drafts.sources.getSnapshot()[0]?.operation.state).toBe('unknown'));
    const original = h.workbench.drafts.sources.getSnapshot()[0]!;
    await act(async () => recovery === 'fresh-login' ? h.workbench.controller.login('synthetic') : h.workbench.controller.check());
    choose(file); await waitFor(() => expect(screen.getByText('Only saved results are checked. No request is sent again. An absent result does not prove the upload failed.')).toBeVisible());
    expect(upload()).toBeDisabled();
    expect(h.workbench.drafts.sources.getSnapshot()).toHaveLength(1);
    expect(h.workbench.drafts.sources.get(original.id)?.operation.token).toBe(original.operation.token);
    expect(requests.filter(r => r.method === 'POST' && r.url.includes('/sources'))).toHaveLength(1);
});

it('explicitly discards a retired never-sent input without releasing an ambiguous original', async () => {
    sourceServer();
    const h = await renderSourceFeature(<UploadStatus notebookId="n" onInclude={() => {}} onChanged={() => {}} includeDisabled/>);
    const store = h.workbench.drafts.sources;
    let unsent!: string, uncertain!: string;
    await act(async () => {
        const c = readTurnContext()!, g = sessionCoordinator.current();
        unsent = await store.captureUpload('n', new File(['unsent'], 'unsent.txt'), c, g);
        uncertain = await store.captureUpload('n', new File(['unknown'], 'unknown.txt'), c, g);
        const a = store.begin(uncertain, c, g)!;
        store.settle(uncertain, a.operation.token!, { kind: 'unknown' }, c, g);
    });
    await act(async () => h.workbench.controller.login('synthetic'));
    const token = store.get(uncertain)!.operation.token;
    expect(screen.getAllByRole('button', { name: 'Discard unsent input' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsent input' }));
    expect(store.get(unsent)).toBeUndefined();
    expect(store.get(uncertain)?.operation.token).toBe(token);
    expect(store.hasUnsaved()).toBe(true);
});

it.each(['accepted', 'lost acknowledgement'])('keeps %s upload identifiers out of announcements and allows only one submission', async outcome => {
    const requests = sourceServer(r => r.method === 'POST'
        ? outcome === 'accepted' ? json(receipt) : Promise.reject(new Error('lost ack'))
        : json({}));
    function UploadFlow() {
        const [open, setOpen] = useState(true);
        return <><AddSourceDialog notebookId="n" sourceId="source:exact" sourceTitle="Research source" open={open} onClose={() => setOpen(false)} onChanged={() => {}}/><UploadStatus notebookId="n" onInclude={() => {}} onChanged={() => {}} includeDisabled/></>;
    }
    const h = await renderSourceFeature(<UploadFlow/>);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Research source')).toBeVisible();
    const versionDetails = within(dialog).getByText('source:exact').closest('details');
    expect(versionDetails).toBeInTheDocument();
    expect(versionDetails).not.toHaveAttribute('open');

    choose(new File(['plain text'], 'research.txt', { type: 'text/plain' }));
    await waitFor(() => expect(upload()).toBeEnabled());
    fireEvent.click(upload());
    const expected = outcome === 'accepted' ? 'succeeded' : 'unknown';
    await waitFor(() => expect(h.workbench.drafts.sources.getSnapshot()[0]?.operation.state).toBe(expected));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const saved = h.workbench.drafts.sources.getSnapshot()[0]!;
    const row = screen.getByText(saved.id, { exact: true }).closest('li')!;
    const details = within(row).getByText(saved.id, { exact: true }).closest('details');
    expect(details).toBeInTheDocument();
    expect(details).not.toHaveAttribute('open');
    expect(details?.closest('[aria-live], [role="status"]')).toBeNull();
    const status = within(row).getByRole('status');
    expect(status).toHaveTextContent('research.txt');
    expect(status).toHaveTextContent(outcome === 'accepted'
        ? sourceMessages['en-US'].accepted : resources['en-US'].translation.workbench.uploadUncertain);
    expect(status).not.toHaveTextContent(saved.id);
    expect(status).not.toHaveTextContent(receipt.job_id);
    fireEvent.click(within(row).getByText('Technical details'));
    expect(details).toHaveAttribute('open');
    if (outcome === 'accepted') {
        expect(within(row).getByText(resources['en-US'].translation.workbench.jobId + ': ' + receipt.job_id).closest('details')).toBe(details);
    } else {
        await act(async () => h.workbench.controller.check());
        const checks = () => requests.filter(r => r.method === 'GET' && r.url.endsWith('/workspace-view')).length;
        const before = checks();
        const check = within(row).getByRole('button', { name: /check/i });
        await waitFor(() => expect(check).toBeEnabled());
        fireEvent.click(check);
        await waitFor(() => expect(checks()).toBe(before + 1));
    }
    expect(requests.filter(r => r.method === 'POST' && r.url.includes('/sources'))).toHaveLength(1);
});
