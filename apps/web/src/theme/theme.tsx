import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';
export const APPEARANCE_KEY = 'study-workbench.appearance.v1';
export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme { return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference; }
export function readThemePreference(): ThemePreference {
    try {
        const value = localStorage.getItem(APPEARANCE_KEY);
        if (value === 'light' || value === 'dark' || value === 'system')
            return value;
    }
    catch { /* Private/restricted storage: keep in-memory preference. */ }
    return 'system';
}
type ThemeValue = {
    preference: ThemePreference;
    resolved: ResolvedTheme;
    setThemePreference(value: ThemePreference): void;
};
const Context = createContext<ThemeValue | null>(null);
export function ThemeProvider({ children }: {
    children: ReactNode;
}) {
    const [preference, setPreference] = useState(readThemePreference);
    const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
    const resolved = resolveTheme(preference, systemDark);
    useLayoutEffect(() => { document.documentElement.dataset.theme = resolved; document.documentElement.style.colorScheme = resolved; }, [resolved]);
    useEffect(() => { const media = window.matchMedia('(prefers-color-scheme: dark)'); const update = () => setSystemDark(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
    function setThemePreference(value: ThemePreference) { setPreference(value); try {
        localStorage.setItem(APPEARANCE_KEY, value);
    }
    catch { /* Switching still works for this page. */ } }
    return <Context.Provider value={{ preference, resolved, setThemePreference }}>{children}</Context.Provider>;
}
export function useTheme(): ThemeValue { const value = useContext(Context); if (!value)
    throw new Error('ThemeProvider required'); return value; }
