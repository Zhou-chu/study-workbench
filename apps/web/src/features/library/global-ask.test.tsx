import { act, fireEvent, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderLibrary } from '../../test/library-harness';
import { globalServer, askStream } from '../../test/global-fixtures';
async function open() { await renderLibrary('/search?q=Original question&mode=ask'); fireEvent.click(await screen.findByRole('button', { name: 'Ask library' })); await screen.findByRole('dialog'); }
async function start() { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start answer' })); }
it('models cancel without provider work, then explicit three models dispatch once and show whole strategy/intermediates/final', async () => {
    const requests = globalServer();
    await open();
    for (const label of ['Strategy model', 'Answer model', 'Final answer model'])
        fireEvent.change(within(screen.getByRole('dialog')).getByLabelText(label), { target: { value: 'model:other' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Ask library' }));
    await start();
    expect(await screen.findByText('Final answer')).toBeVisible();
    expect(screen.getByText('Intermediate answers')).toBeVisible();
    fireEvent.click(screen.getByText('Strategy'));
    expect(screen.getByText('Plan carefully')).toBeVisible();
    fireEvent.click(screen.getByText('Intermediate answers'));
    expect(screen.getByText('Intermediate one')).toBeVisible();
    expect(screen.getByText('Intermediate two')).toBeVisible();
    const sent = requests.filter(r => r.url.endsWith('/search/ask'));
    expect(sent).toHaveLength(1);
    expect(await sent[0]!.clone().json()).toEqual({ question: 'Original question', strategy_model: 'model:language', answer_model: 'model:language', final_answer_model: 'model:language', notebook_ids: [] });
    expect(requests.some(r => r.url.includes('chat/sessions'))).toBe(false);
    expect(screen.getByRole('button', { name: 'Save answer to notebooks' })).toBeEnabled();
});
it.each([
    [[{ type: 'answer', content: 'Retained partial' }, { type: 'complete', final_answer: null }], 'Finished without an answer.'],
    [[{ type: 'answer', content: 'Retained partial' }, { type: 'error', message: 'Provider refused' }], 'Answer failed.'],
    [[{ type: 'answer', content: 'Retained partial' }], 'Outcome unknown. No automatic retry.'],
    [[{ type: 'answer', content: 'Retained partial' }, { type: 'complete' }], 'Outcome unknown. No automatic retry.']
])('distinguishes terminal and incomplete Ask outcomes %#', async (events, label) => {
    const requests = globalServer(r => r.url.endsWith('/search/ask') ? askStream(events as unknown[]) : undefined);
    await open();
    await start();
    expect(await screen.findByText(label as string)).toBeVisible();
    fireEvent.click(screen.getByText('Intermediate answers'));
    expect(screen.getByText('Retained partial')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save answer to notebooks' })).toBeNull();
    expect(requests.filter(r => r.url.endsWith('/search/ask'))).toHaveLength(1);
});
it('double click and observation cancellation preserve original partial output without a cancel endpoint', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const encode = (v: unknown) => new TextEncoder().encode('data: ' + JSON.stringify(v) + '\n\n');
    const requests = globalServer(r => r.url.endsWith('/search/ask') ? new Response(new ReadableStream({ start(c) { controller = c; c.enqueue(encode({ type: 'answer', content: 'Still partial' })); } }), { headers: { 'content-type': 'text/event-stream' } }) : undefined);
    await open();
    const button = within(screen.getByRole('dialog')).getByRole('button', { name: 'Start answer' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    await screen.findByText('Intermediate answers');
    fireEvent.click(screen.getByRole('button', { name: 'Stop observing' }));
    expect(await screen.findByText('Outcome unknown. No automatic retry.')).toBeVisible();
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
    expect(controller).toBeDefined();
});
it('explicit model choices and Ask scope do not inherit Search source/note switches', async () => {
    const requests = globalServer();
    await renderLibrary('/search?q=Scoped');
    fireEvent.click(await screen.findByLabelText('Include sources'));
    fireEvent.click(screen.getByLabelText('Include notes'));
    fireEvent.click(await screen.findByLabelText('Search scope · Beta'));
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'ask' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask library' }));
    const d = screen.getByRole('dialog');
    fireEvent.change(within(d).getByLabelText('Strategy model'), { target: { value: 'model:other' } });
    fireEvent.change(within(d).getByLabelText('Answer model'), { target: { value: 'model:language' } });
    fireEvent.change(within(d).getByLabelText('Final answer model'), { target: { value: 'model:other' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Start answer' }));
    await screen.findByText('Final answer');
    expect(await requests.find(r => r.url.endsWith('/search/ask'))!.clone().json()).toEqual({ question: 'Scoped', strategy_model: 'model:other', answer_model: 'model:language', final_answer_model: 'model:other', notebook_ids: ['notebook:beta:full'] });
});
it('Ask reference opens the reviewed source consumer without creating sessions or save grants', async () => {
    const requests = globalServer();
    await open();
    await start();
    await screen.findByText('Final answer');
    fireEvent.click(screen.getByRole('button', { name: 'Open reference · source:alpha:full' }));
    expect(await within(screen.getByRole('dialog')).findByRole('button', { name: 'Chat with source' })).toBeVisible();
    expect(requests.some(r => r.url.includes('/chat/sessions'))).toBe(false);
    expect(requests.filter(r => r.url.endsWith('/notes') && r.method === 'POST')).toHaveLength(0);
});
