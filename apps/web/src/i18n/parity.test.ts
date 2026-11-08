import { expect, it } from 'vitest';
import { resources, languages, shellMessages, sessionMessages } from './index';
const codes = ['zh-CN', 'en-US', 'zh-TW', 'pt-BR', 'ja-JP', 'it-IT', 'fr-FR', 'ru-RU', 'bn-IN', 'ca-ES', 'es-ES', 'de-DE', 'pl-PL', 'tr-TR'];
function leaves(value: unknown, prefix = ''): Record<string, string> { const out: Record<string, string> = {}; if (value && typeof value === 'object')
    for (const [key, child] of Object.entries(value)) {
        const name = prefix + key;
        if (typeof child === 'string')
            out[name] = child;
        else
            Object.assign(out, leaves(child, name + '.'));
    } ; return out; }
it('migrates all registry languages and complete legacy keysets', () => {
    expect(Object.keys(resources).sort()).toEqual([...codes].sort());
    expect(languages).toHaveLength(14);
    const reference = Object.keys(leaves(resources['en-US'])).sort();
    expect(reference.length).toBe(1404);
    for (const code of codes)
        expect(Object.keys(leaves(resources[code as keyof typeof resources])).sort(), code).toEqual(reference);
});
it('provides translated shell messages and matching interpolation without fallback', () => {
    const reference = leaves(shellMessages['en-US']);
    expect(Object.keys(reference).length).toBeGreaterThan(15);
    for (const code of codes) {
        const messages = leaves(shellMessages[code as keyof typeof shellMessages]);
        expect(Object.keys(messages).sort(), code).toEqual(Object.keys(reference).sort());
        for (const [key, value] of Object.entries(reference)) {
            expect(messages[key]?.trim(), `${code}.${key}`).toBeTruthy();
            expect(messages[key]?.match(/\{\{\w+\}\}/g) || []).toEqual(value.match(/\{\{\w+\}\}/g) || []);
        }
    }
});

it('provides every authentication/navigation label in all fourteen languages explicitly',()=>{
 const reference=Object.keys(sessionMessages['en-US']).sort();
 for(const code of codes){const messages=sessionMessages[code as keyof typeof sessionMessages];expect(Object.keys(messages).sort()).toEqual(reference);for(const value of Object.values(messages))expect(value.trim()).not.toBe('');}
});
