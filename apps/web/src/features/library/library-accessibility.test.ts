import { expect, it } from 'vitest';
import { resources } from '../../i18n/locales';
import { libraryMessages } from '../../i18n/library-messages';
it('provides every source and shell label explicitly in all fourteen supported locales', () => {
    expect(Object.keys(resources)).toHaveLength(14);
    expect(Object.keys(libraryMessages).sort()).toEqual(Object.keys(resources).sort());
    const keys = Object.keys(libraryMessages['en-US']).sort();
    for (const [locale, messages] of Object.entries(libraryMessages)) {
        expect(Object.keys(messages).sort(), locale).toEqual(keys);
        for (const [key, value] of Object.entries(messages)) {
            expect(value.trim(), locale + ':' + key).not.toBe('');
            expect(value.match(/\{\w+\}/g) ?? [], locale + ':' + key).toEqual(libraryMessages['en-US'][key as keyof typeof libraryMessages['en-US']].match(/\{\w+\}/g) ?? []);
        }
        if (locale !== 'en-US')
            expect(messages.noEvidence).not.toBe(libraryMessages['en-US'].noEvidence);
    }
});
