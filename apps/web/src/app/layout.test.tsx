import { fireEvent, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { render } from '@testing-library/react';
import { WorkspaceLayout } from './WorkspaceLayout';
import { I18nProvider } from '../i18n';
import { renderApp } from '../test/render-app';
import { syntheticWorkspace } from '../test/fixtures';
import type { WebTransport } from '@study/web-transport';
it('keeps slot DOM and draft while reader opens and sections change', () => {
    const props = { sources: <p>Source material</p>, conversation: <textarea aria-label="Draft" defaultValue="Keep me"/>, studio: <p>Saved results</p>, reader: <input aria-label="Page" defaultValue="7"/>, readerOpen: false, activeSection: 'conversation' as const, onSectionChange: () => { } };
    const view = render(<I18nProvider><WorkspaceLayout {...props}/></I18nProvider>);
    const draft = screen.getByLabelText('Draft');
    const reader = screen.getByLabelText('Page');
    view.rerender(<I18nProvider><WorkspaceLayout {...props} readerOpen activeSection="sources"/></I18nProvider>);
    expect(screen.getByLabelText('Draft')).toBe(draft);
    expect(draft).toHaveValue('Keep me');
    expect(screen.getByLabelText('Page')).toBe(reader);
    expect(document.querySelector('.workspace-layout')).toHaveAttribute('data-reader-open', 'true');
});
it('has responsive three-area, dual/drawer and full-screen reader rules', () => {
    const css = readFileSync('src/app/styles.css', 'utf8');
    expect(css).toContain('min-width: 1280px');
    expect(css).toContain('min-width: 900px');
    expect(css).toContain('max-width: 899px');
    expect(css).toMatch(/data-reader-open="true"[^}]+workspace-studio[^}]+display:\s*none/s);
    expect(css).toContain('env(safe-area-inset-bottom)');
});
it('wraps the real router/providers without fabricating auth or dispatching', () => {
    let requests = 0;
    const transport: WebTransport = { send: async () => { requests++; return new Response('{}'); } };
    renderApp({ route: '/notebooks/synthetic', transport, workspace: syntheticWorkspace });
    expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
    expect(screen.getByText(/Scaffold preview/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(requests).toBe(0);
    expect(Object.keys(localStorage)).toEqual(['study-workbench.appearance.v1']);
});

it('names the generic skip target correctly on home and makes main focusable',()=>{
 renderApp();const link=screen.getByRole('link',{name:'Skip to main content'});expect(link).toHaveAttribute('href','#main-content');
 const main=screen.getByRole('main');main.focus();expect(main).toHaveFocus();
});
