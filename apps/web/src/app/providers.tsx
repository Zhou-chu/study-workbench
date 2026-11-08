import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WebTransport } from '@study/web-transport';
import type { WorkspaceViewV1 } from '@study/contracts';
import { I18nProvider } from '../i18n';
import type { LanguageCode } from '../i18n';
import { ThemeProvider } from '../theme/theme';
import { createDraftRegistry, type DraftRegistry } from './drafts';
const DraftsContext = createContext<DraftRegistry | null>(null);
export function useAppDrafts() {
    const value = useContext(DraftsContext);
    if (!value)
        throw new Error('AppProviders required');
    return value;
}
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
    const [drafts] = useState(createDraftRegistry);
    const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } }));
    // B2 owns validated config and real transport construction; this provider never establishes authentication.
    return <DraftsContext.Provider value={drafts}><I18nProvider {...(locale ? { initialLocale: locale } : {})}><ThemeProvider><QueryClientProvider client={queryClient}><Context.Provider value={{ transport, workspace }}>{children}</Context.Provider></QueryClientProvider></ThemeProvider></I18nProvider></DraftsContext.Provider>;
}
export function useAppData(): AppData {
    const value = useContext(Context);
    if (!value)
        throw new Error('AppProviders required');
    return value;
}
/** Nested session boundary changes the adapter without rebuilding presentation providers. */
export function AppDataBoundary({ children, transport, workspace }: {
    children: ReactNode;
    transport: WebTransport;
    workspace: WorkspaceViewV1 | undefined;
}) { return <Context.Provider value={{ transport, workspace }}>{children}</Context.Provider>; }
