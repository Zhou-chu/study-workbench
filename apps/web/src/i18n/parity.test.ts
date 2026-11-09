import { expect, it } from 'vitest';
import { resources, languages, shellMessages, sessionMessages, notebookMessages, sourceMessages, chatMessages } from './index';
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

it('provides every notebook integration label explicitly in all fourteen languages',()=>{const keys=Object.keys(notebookMessages['en-US']).sort();for(const code of codes){const messages=notebookMessages[code as keyof typeof notebookMessages];expect(Object.keys(messages).sort()).toEqual(keys);for(const value of Object.values(messages))expect(value.trim()).not.toBe('');}});

it('provides every source safety and operation label in all fourteen languages',()=>{const keys=Object.keys(sourceMessages['en-US']).sort();for(const code of codes){const messages=sourceMessages[code as keyof typeof sourceMessages];expect(Object.keys(messages).sort()).toEqual(keys);for(const value of Object.values(messages))expect(value.trim()).not.toBe('');}});

it('provides explicit conversation limits and recovery copy in every locale',()=>{const keys=Object.keys(chatMessages['en-US']).sort();expect(Object.keys(chatMessages).sort()).toEqual([...codes].sort());for(const code of codes){const messages=chatMessages[code as keyof typeof chatMessages];expect(Object.keys(messages).sort()).toEqual(keys);for(const value of Object.values(messages))expect(value.trim()).not.toBe('');}});

import { readerMessages } from './reader-messages';
it('provides every reader integrity and historical-version label in all fourteen locales',()=>{expect(Object.keys(readerMessages).sort()).toEqual([...codes].sort());for(const row of Object.values(readerMessages)){expect(Object.keys(row).sort()).toEqual(['invalid','retired','savePosition','unavailable','unsaved']);for(const value of Object.values(row))expect(value.trim()).not.toBe('');}});

import { studioMessages } from './studio-messages';
it('provides explicit Studio uncertainty, compatibility and download labels in all fourteen locales',()=>{expect(Object.keys(studioMessages).sort()).toEqual([...codes].sort());const keys=Object.keys(studioMessages['en-US']).sort();expect(keys).toHaveLength(12);for(const row of Object.values(studioMessages)){expect(Object.keys(row).sort()).toEqual(keys);for(const value of Object.values(row))expect(value.trim()).not.toBe('');}});

import {retrievalMessages} from './retrieval-messages';
it('provides B9d safety copy in all fourteen languages without fallback',()=>{expect(Object.keys(retrievalMessages).sort()).toEqual([...codes].sort());for(const values of Object.values(retrievalMessages)){expect(Object.keys(values).sort()).toEqual(Object.keys(retrievalMessages['en-US']).sort());for(const text of Object.values(values))expect(text.trim()).not.toBe('');}});
