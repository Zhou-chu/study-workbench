import { resources, type LanguageCode } from './locales';

type TranslationRow = Readonly<Record<LanguageCode, string>>;
type Catalog<K extends string> = Record<LanguageCode, Record<K, string>>;

type Translations = Readonly<Record<string, TranslationRow>>;

function transpose(messages: Translations, locales: readonly LanguageCode[]) {
    const entries = Object.entries<TranslationRow>(messages);
    return Object.fromEntries(locales.map(locale => [
        locale, Object.fromEntries(entries.map(([key, byLocale]) => [key, byLocale[locale]])),
    ]));
}

/** Published order for the native, global and library surfaces. */
export const publishedLocaleOrder = [
    "en-US", "zh-CN", "zh-TW", "ja-JP", "pt-BR", "it-IT", "fr-FR",
    "ru-RU", "bn-IN", "ca-ES", "es-ES", "de-DE", "pl-PL", "tr-TR",
] as const satisfies readonly LanguageCode[];

/** Author each message once; require all locale translations at its declaration. */
export function messageCatalog<K extends string>(messages: Record<K, TranslationRow>, locales: readonly LanguageCode[] = Object.keys(resources) as LanguageCode[]): Catalog<K> {
    return transpose(messages, locales) as Catalog<K>;
}

type AuthoredCatalog<T extends Translations> = {
    readonly [L in LanguageCode]: { readonly [K in keyof T]: T[K][L] };
};

/** Carry the original locale iteration order and literal types across a catalog migration. */
export function orderedMessageCatalog<const T extends Translations>(messages: T): AuthoredCatalog<T> {
    const first = Object.values(messages)[0];
    return transpose(messages, first ? Object.keys(first) as LanguageCode[] : []) as AuthoredCatalog<T>;
}

/** Shell preview and session affordances refer to the same workspace state. */
export const studyWorkspaceNotice = {
    "en-US": "Study actions are still being connected.",
    "zh-CN": "学习功能仍在接入中。",
    "zh-TW": "學習功能仍在接入中。",
    "pt-BR": "As funções de estudo ainda estão sendo conectadas.",
    "ja-JP": "学習機能はまだ接続作業中です。",
    "it-IT": "Le funzioni di studio sono ancora in fase di collegamento.",
    "fr-FR": "Les fonctions d’étude sont encore en cours de connexion.",
    "ru-RU": "Учебные функции ещё подключаются.",
    "bn-IN": "পড়াশোনার সুবিধাগুলি এখনও সংযুক্ত করা হচ্ছে।",
    "ca-ES": "Les funcions d’estudi encara s’estan connectant.",
    "es-ES": "Las funciones de estudio aún se están conectando.",
    "de-DE": "Die Lernfunktionen werden noch verbunden.",
    "pl-PL": "Funkcje nauki są nadal podłączane.",
    "tr-TR": "Çalışma özellikleri hâlâ bağlanıyor.",
} satisfies TranslationRow;
