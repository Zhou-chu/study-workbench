import { useEffect, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ThemeProvider, resolveTheme, readThemePreference, useTheme } from './theme';
import { ThemeControl } from './ThemeControl';
import { I18nProvider } from '../i18n';
const key = 'study-workbench.appearance.v1';
describe('theme preference', () => {
    it.each([['system', true, 'dark'], ['system', false, 'light'], ['dark', false, 'dark'], ['light', true, 'light']] as const)('resolves %s / system dark %s to %s', (preference, dark, want) => expect(resolveTheme(preference, dark)).toBe(want));
    it('reads only a valid appearance preference', () => { localStorage.setItem(key, 'dark'); expect(readThemePreference()).toBe('dark'); localStorage.setItem(key, 'arbitrary'); expect(readThemePreference()).toBe('system'); });
    it('applies manual preference before React mounts', () => {
        localStorage.setItem(key, 'dark');
        window.eval(readFileSync('public/theme-bootstrap.js', 'utf8'));
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(document.documentElement.style.colorScheme).toBe('dark');
    });
    it('bootstraps system theme when storage is rejected', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addEventListener() { }, removeEventListener() { } } as unknown as MediaQueryList);
        expect(() => window.eval(readFileSync('public/theme-bootstrap.js', 'utf8'))).not.toThrow();
        expect(document.documentElement.dataset.theme).toBe('dark');
    });
    it('follows system changes only in system mode and unsubscribes', () => {
        let listener: (() => void) | undefined;
        let dark = false;
        const remove = vi.fn();
        vi.mocked(window.matchMedia).mockImplementation(() => ({ get matches() { return dark; }, addEventListener: (_: string, fn: () => void) => { listener = fn; }, removeEventListener: remove }) as unknown as MediaQueryList);
        function Value() { return <output>{useTheme().resolved}</output>; }
        const view = render(<I18nProvider><ThemeProvider><ThemeControl /><Value /></ThemeProvider></I18nProvider>);
        expect(screen.getByRole('status')).toHaveTextContent('light');
        dark = true;
        act(() => listener?.());
        fireEvent.click(screen.getByRole('button', { name: 'Light' }));
        expect(document.documentElement.dataset.theme).toBe('light');
        view.unmount();
        expect(remove).toHaveBeenCalled();
    });
    it('keeps draft, file, reader page and mount while storage writes are denied', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
        let mounts = 0;
        const file = new File(['synthetic'], 'synthetic.txt');
        function Reader() { useEffect(() => { mounts++; }, []); const [page, setPage] = useState(7); return <input aria-label="Page" type="number" value={page} onChange={e => setPage(Number(e.target.value))}/>; }
        function Draft() { const [draft, setDraft] = useState('Unsaved note'); const [selected] = useState(file); return <><textarea aria-label="Draft" value={draft} onChange={e => setDraft(e.target.value)}/><output>{selected.name}</output><Reader /></>; }
        render(<I18nProvider><ThemeProvider><ThemeControl /><Draft /></ThemeProvider></I18nProvider>);
        fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(screen.getByLabelText('Draft')).toHaveValue('Unsaved note');
        expect(screen.getByLabelText('Page')).toHaveValue(7);
        expect(screen.getByText(file.name)).toBeVisible();
        expect(mounts).toBe(1);
    });
});
