import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nativeMessages as labels } from '../../i18n/native-messages';
import { languages } from '../../i18n';

it('has explicit translated labels in every supported locale', () => {
    for (const { code } of languages) {
        expect(Object.keys(labels[code]).sort()).toEqual(Object.keys(labels['en-US']).sort());
        expect(Object.values(labels[code]).every(v => v.trim())).toBe(true);
    }
});

it('styles native controls with 44px targets and monochrome tokens', () => {
    const css = readFileSync('src/app/styles.css', 'utf8');
    expect(css).toMatch(/\.native-chat input,[^}]+min-height: 44px;[^}]+min-width: 44px;/s);
    expect(css).toMatch(/\.native-chat input,[^}]+color: var\(--text\);[^}]+background: var\(--surface\);/s);
});
