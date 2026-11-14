import { screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderLibrary } from '../test/library-harness';
import { transformationServer } from '../test/transformation-fixtures';
it.each([
    ['/login', 'Password'], ['/settings', 'Document Processing Engine'],
    ['/settings#web-search', 'Document Processing Engine'], ['/settings/models', 'Chat Model'],
    ['/transformations', 'Transformation records'], ['/advanced', 'Rebuild mode']
])('mounts the actual substantive B9 route %s, never a retained placeholder', async (path, label) => {
    transformationServer();
    const h = await renderLibrary(path);
    expect(await screen.findByLabelText(label!)).toBeVisible();
    expect(screen.queryByText('This page is being rebuilt. Its features are not connected yet.')).toBeNull();
    if (path === '/settings#web-search') {
        expect(h.router.state.location.hash).toBe('#web-search');
        await waitFor(() => expect(document.getElementById('web-search')).toHaveFocus());
        expect(screen.getByRole('button', { name: 'Retry web-search status' })).toBeVisible();
    }
    if (path === '/transformations')
        expect(await screen.findByRole('heading', { name: 'First transformation' })).toBeVisible();
});
