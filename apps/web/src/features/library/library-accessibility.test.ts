import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
it('uses minimum 44px controls, visible focus and original media without grayscale filters', () => {
    const css = readFileSync('src/app/styles.css', 'utf8');
    expect(css).toMatch(/button, \.button, select, input \{ min-block-size: 44px; min-inline-size: 44px;/);
    expect(css).toMatch(/\.library-check input \{ width: 44px; min-width: 44px; height: 44px;/);
    expect(css).toMatch(/\.library-list a \{[^}]*min-height: 44px/);
    expect(css).toContain(':focus-visible { outline: 2px solid var(--focus)');
    expect(css).not.toMatch(/filter:\s*(?:grayscale|saturate)/);
    expect(css).not.toContain('mix-blend-mode');
});
