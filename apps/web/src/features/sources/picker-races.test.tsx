import { useState } from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sourceContext, receipt } from '../../test/source-fixtures';
import { renderSourceFeature, sourceServer } from '../../test/source-harness';
import { json } from '../../test/notebook-fixtures';
import { AddSourceDialog } from './AddSourceDialog';

let pendingReleases: Array<() => Promise<void>> = [];
beforeEach(sourceContext);
afterEach(async () => { await act(async () => { for (const release of pendingReleases) await release(); }); pendingReleases = []; });
function holdDigests() {
    const real = crypto.subtle.digest.bind(crypto.subtle);
    const releases: Array<() => Promise<void>> = [];
    pendingReleases = releases;
    vi.spyOn(crypto.subtle, 'digest').mockImplementation((algorithm, data) => new Promise(resolve => {
        releases.push(async () => { resolve(await real(algorithm, data)); });
    }));
    return releases;
}
const dialog = () => within(screen.getByRole('dialog'));
const upload = () => dialog().getByRole('button', { name: 'Upload' });
const choose = (...files: File[]) => fireEvent.change(screen.getByLabelText('Choose files'), { target: { files } });
const panel = <AddSourceDialog notebookId="n" open onClose={() => { }} onChanged={() => { }} />;

it('disables submission immediately when a newer picker choice is still hashing', async () => {
    const releases = holdDigests(), requests = sourceServer(() => json(receipt));
    await renderSourceFeature(panel);
    choose(new File(['aaa'], 'a.txt'));
    await waitFor(() => expect(releases).toHaveLength(1));
    await act(releases[0]!);
    await waitFor(() => expect(upload()).toBeEnabled());
    choose(new File(['bbb'], 'b.txt'));
    await waitFor(() => expect(releases).toHaveLength(2));
    expect(upload()).toBeDisabled();
    fireEvent.click(upload());
    expect(requests.some(request => request.method === 'POST')).toBe(false);
    await waitFor(() => expect(releases).toHaveLength(2));
    await act(releases[1]!);
    await waitFor(() => expect(upload()).toBeEnabled());
});

it('keeps only the newest picker result when older file hashing finishes last', async () => {
    const releases = holdDigests(), requests = sourceServer(() => json(receipt));
    const h = await renderSourceFeature(panel);
    const a = new File(['aaa'], 'a.txt'), b = new File(['bbb'], 'b.txt');
    choose(a);
    await waitFor(() => expect(releases).toHaveLength(1));
    choose(b);
    await waitFor(() => expect(releases).toHaveLength(2));
    await act(releases[1]!);
    await waitFor(() => expect(upload()).toBeEnabled());
    await act(releases[0]!);
    expect(dialog().queryByText('a.txt')).not.toBeInTheDocument();
    expect(dialog().getByText('b.txt')).toBeVisible();
    fireEvent.click(upload());
    await waitFor(() => expect(requests.filter(request => request.method === 'POST')).toHaveLength(1));
    expect(h.workbench.drafts.sources.getSnapshot().find(row => row.operation.state !== 'idle')?.file).toBe(b);
});

it('does not revive old A or B results after A to B to A and a cleared picker', async () => {
    const releases = holdDigests(), requests = sourceServer(() => json(receipt));
    const h = await renderSourceFeature(panel);
    const a = new File(['aaa'], 'same.txt', { lastModified: 1 }), b = new File(['bbb'], 'same.txt', { lastModified: 1 });
    choose(a); await waitFor(() => expect(releases).toHaveLength(1));
    choose(b); await waitFor(() => expect(releases).toHaveLength(2));
    choose(a); await waitFor(() => expect(releases).toHaveLength(3));
    await act(releases[2]!);
    await waitFor(() => expect(upload()).toBeEnabled());
    const latestId = h.workbench.drafts.sources.getSnapshot()[0]!.id;
    choose();
    await act(releases[1]!);
    await act(releases[0]!);
    expect(upload()).toBeDisabled();
    expect(dialog().queryByText('same.txt')).not.toBeInTheDocument();
    expect(requests.some(request => request.method === 'POST')).toBe(false);
    const rows = h.workbench.drafts.sources.getSnapshot();
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.file === a)?.id).toBe(latestId);
    expect(rows.find(row => row.file === b)?.id).not.toBe(latestId);
});

it('retires a hashing picker result on privacy retirement without losing its original registry File', async () => {
    const releases = holdDigests(); sourceServer(() => json(receipt));
    const h = await renderSourceFeature(panel), file = new File(['aaa'], 'retired.txt');
    choose(file); await waitFor(() => expect(releases).toHaveLength(1));
    act(() => h.workbench.controller.retirePrivacyContext());
    await act(releases[0]!);
    expect(dialog().queryByText('retired.txt')).not.toBeInTheDocument();
    expect(upload()).toBeDisabled();
    expect(h.workbench.drafts.sources.getSnapshot()[0]).toMatchObject({ file, retired: true });
});

it('does not populate a remounted picker from a previous mount hashing result', async () => {
    const releases = holdDigests(); sourceServer(() => json(receipt));
    let show!: (value: boolean) => void;
    function Toggle() { const [visible, setVisible] = useState(true); show = setVisible; return visible ? panel : null; }
    const h = await renderSourceFeature(<Toggle />);
    const file = new File(['aaa'], 'unmounted.txt');
    choose(file); await waitFor(() => expect(releases).toHaveLength(1));
    act(() => show(false)); act(() => show(true));
    await act(releases[0]!);
    expect(dialog().queryByText('unmounted.txt')).not.toBeInTheDocument();
    expect(upload()).toBeDisabled();
    expect(h.workbench.drafts.sources.getSnapshot()[0]?.file).toBe(file);
});
