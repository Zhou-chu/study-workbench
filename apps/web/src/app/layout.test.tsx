import { act, fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
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
    expect(screen.queryByText(/Scaffold preview/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(requests).toBe(0);
    expect(Object.keys(localStorage)).toEqual(['study-workbench.appearance.v1']);
});

it('names the generic skip target correctly on home and makes main focusable',()=>{
 renderApp();const link=screen.getByRole('link',{name:'Skip to main content'});expect(link).toHaveAttribute('href','#main-content');
 const main=screen.getByRole('main');main.focus();expect(main).toHaveFocus();
});

it('expands reading or answers without remounting live editors, then restores side-by-side', () => {
 const props = { sources: <p>Source material</p>, conversation: <textarea aria-label="Draft" defaultValue="Keep me"/>, studio: <p>Saved results</p>, reader: <input aria-label="Page" defaultValue="7"/>, readerOpen: true, activeSection: 'conversation' as const, onSectionChange: () => {} };
 render(<I18nProvider><WorkspaceLayout {...props}/></I18nProvider>);
 const draft = screen.getByLabelText('Draft'), reader = screen.getByLabelText('Page');
 fireEvent.click(screen.getByRole('button', {name:'Expand reading'}));
 expect(document.querySelector('.workspace-layout')).toHaveAttribute('data-focus','reader');
 fireEvent.click(screen.getByRole('button', {name:'Expand answers'}));
 expect(document.querySelector('.workspace-layout')).toHaveAttribute('data-focus','conversation');
 fireEvent.click(screen.getByRole('button', {name:'Side by side'}));
 expect(document.querySelector('.workspace-layout')).toHaveAttribute('data-focus','balanced');
 expect(screen.getByLabelText('Draft')).toBe(draft);
 expect(screen.getByLabelText('Page')).toBe(reader);
 expect(draft).toHaveValue('Keep me');
 expect(reader).toHaveValue('7');
 const regions = [...document.querySelector('.workspace-layout')!.children];
 expect(regions.indexOf(reader.closest('section')!)).toBeLessThan(regions.indexOf(draft.closest('section')!));
});
it('does not advertise reader focus before any document is open', () => {
 render(<I18nProvider><WorkspaceLayout sources={null} conversation={null} studio={null} reader={null} readerOpen={false} activeSection="conversation" onSectionChange={()=>{}}/></I18nProvider>);
 expect(screen.queryByRole('button',{name:'Expand reading'})).not.toBeInTheDocument();
});

it('reveals a new citation without replacing the draft or reader slots',()=>{
 const props={sources:null,conversation:<textarea aria-label="Draft" defaultValue="Keep"/>,studio:null,reader:<input aria-label="Page" defaultValue="7"/>,readerOpen:true,activeSection:'conversation' as const,onSectionChange:()=>{}};
 const view=render(<I18nProvider><WorkspaceLayout {...props} readerKey="first"/></I18nProvider>);
 const draft=screen.getByLabelText('Draft'),page=screen.getByLabelText('Page');
 fireEvent.click(screen.getByRole('button',{name:'Expand answers'}));
 expect(document.querySelector('.workspace-layout')).toHaveAttribute('data-focus','conversation');
 view.rerender(<I18nProvider><WorkspaceLayout {...props} readerKey="second"/></I18nProvider>);
 expect(document.querySelector('.workspace-layout')).toHaveAttribute('data-focus','balanced');
 expect(screen.getByLabelText('Draft')).toBe(draft);expect(screen.getByLabelText('Page')).toBe(page);
});
it('isolates the narrow reader and moves background focus inside on resize, restoring prior inert state',()=>{
 let narrow=false;const listeners=new Set<()=>void>();
 vi.mocked(window.matchMedia).mockImplementation(query=>({get matches(){return narrow},media:query,addEventListener:(_event:string,cb:()=>void)=>listeners.add(cb),removeEventListener:(_event:string,cb:()=>void)=>listeners.delete(cb)} as unknown as MediaQueryList));
 const props={sources:<button>Source</button>,conversation:<textarea aria-label="Draft" defaultValue="Keep"/>,studio:null,reader:<button>Reader close</button>,readerOpen:true,readerKey:'first',activeSection:'conversation' as const,onSectionChange:()=>{}};
 const view=render(<I18nProvider><aside inert>Already inert</aside><WorkspaceLayout {...props}/></I18nProvider>);
 const draft=screen.getByLabelText('Draft');draft.focus();
 act(()=>{narrow=true;listeners.forEach(cb=>cb());});
 expect(screen.getByRole('button',{name:'Reader close'})).toHaveFocus();
 expect(draft.closest('.workspace-conversation')).toHaveAttribute('inert');
 expect(document.querySelector('.study-toolbar')).toHaveAttribute('inert');
 act(()=>{narrow=false;listeners.forEach(cb=>cb());});
 expect(draft.closest('.workspace-conversation')).not.toHaveAttribute('inert');
 expect(screen.getByText('Already inert')).toHaveAttribute('inert');
 view.unmount();
});
