import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { resources, languages } from './locales';
import type { LanguageCode, TranslationKeys } from './locales';
import { shellMessages } from './shell-messages';
export { resources, languages, shellMessages };
export type { LanguageCode, TranslationKeys };
export type ShellMessages = {
    [K in keyof typeof shellMessages['en-US']]: string;
};
type I18nValue = {
    locale: LanguageCode;
    setLocale(value: LanguageCode): void;
    t: TranslationKeys;
    shell: ShellMessages;
};
const Context = createContext<I18nValue | null>(null);
export function detectLocale(value = typeof navigator === 'undefined' ? 'en-US' : navigator.language): LanguageCode {
    if (value in resources)
        return value as LanguageCode;
    return languages.find(item => item.code.split('-')[0] === value.split('-')[0])?.code ?? 'en-US';
}
export function I18nProvider({ children, initialLocale = detectLocale() }: {
    children: ReactNode;
    initialLocale?: LanguageCode;
}) {
    const [locale, setLocale] = useState(initialLocale);
    useEffect(() => { document.documentElement.lang = locale; }, [locale]);
    // Shape type only: parity is tested; this never substitutes English content.
    const t = resources[locale].translation as TranslationKeys;
    return <Context.Provider value={{ locale, setLocale, t, shell: shellMessages[locale] }}>{children}</Context.Provider>;
}
export function useI18n(): I18nValue { const value = useContext(Context); if (!value)
    throw new Error('I18nProvider required'); return value; }
