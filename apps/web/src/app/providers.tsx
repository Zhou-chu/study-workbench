import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WebTransport } from '@study/web-transport';
import type { WorkspaceViewV1 } from '@study/contracts';
import { I18nProvider } from '../i18n';
import type { LanguageCode } from '../i18n';
import { ThemeProvider } from '../theme/theme';
export type AppProviderOptions = {
    transport?: WebTransport;
    workspace?: WorkspaceViewV1;
    locale?: LanguageCode;
};
type AppData = {
    transport: WebTransport | undefined;
    workspace: WorkspaceViewV1 | undefined;
};
const Context = createContext<AppData | null>(null);
export function AppProviders({ children, transport, workspace, locale }: AppProviderOptions & {
    children: ReactNode;
}) {
    const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } }));
    // B2 owns validated config and real transport construction; this provider never establishes authentication.
    return <I18nProvider {...(locale ? { initialLocale: locale } : {})}><ThemeProvider><QueryClientProvider client={queryClient}><Context.Provider value={{ transport, workspace }}>{children}</Context.Provider></QueryClientProvider></ThemeProvider></I18nProvider>;
}
export function useAppData(): AppData { const value = useContext(Context); if (!value)
    throw new Error('AppProviders required'); return value; }
