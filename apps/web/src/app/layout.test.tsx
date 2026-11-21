import { fireEvent, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderApp } from '../test/render-app';
import { syntheticWorkspace } from '../test/fixtures';
import type { WebTransport } from '@study/web-transport';
it('wraps the real router/providers without fabricating auth or dispatching', () => {
    let requests = 0;
    const transport: WebTransport = { send: async () => { requests++; return new Response('{}'); } };
    renderApp({ route: '/notebooks/synthetic', transport, workspace: syntheticWorkspace });
    expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
    expect(screen.queryByText(/Scaffold preview/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(requests).toBe(0);
    expect(Object.keys(localStorage)).toEqual(['study-workbench.appearance.v1']);
});

it('names the generic skip target correctly on home and makes main focusable',()=>{
 renderApp();const link=screen.getByRole('link',{name:'Skip to main content'});expect(link).toHaveAttribute('href','#main-content');
 const main=screen.getByRole('main');main.focus();expect(main).toHaveFocus();
});
