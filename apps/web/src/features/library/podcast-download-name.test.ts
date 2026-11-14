import { describe, expect, it } from 'vitest';
import { podcastDownloadName } from './podcast-download-name';

// Bounded historical oracle only; never give this regex the adversarial input.
function original(name: string) {
    let filename = name.replace(/[<>:"|?*]/g, '_').replace(/[. ]+$/g, '').slice(0, 180) || 'podcast.mp3';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) filename = '_' + filename;
    return filename;
}
describe('podcast download name compatibility', () => {
    it.each([
        ['', 'podcast.mp3'], ['. . ', 'podcast.mp3'], [' a . ', ' a'],
        ['<a>:"|?*', '_a______'], ['CON.mp3', '_CON.mp3'], ['com9', '_com9'],
        ['LPT1.', '_LPT1'], ['com0', 'com0'], ['console.mp3', 'console.mp3'],
        ['a\t', 'a\t'], ['a.\u00a0', 'a.\u00a0'], ['音声.mp3', '音声.mp3'],
    ])('%j preserves its filename contract', (input, output) => {
        expect(podcastDownloadName(input)).toBe(output);
    });
    it('matches the historical expression for every short string in a mixed alphabet', () => {
        let layer = [''];
        for (let length = 0; length <= 5; length++) {
            for (const value of layer) expect(podcastDownloadName(value)).toBe(original(value));
            layer = layer.flatMap(value => ['.', ' ', 'a', '?', '\n', '音'].map(c => value + c));
        }
    });
    it('strips before truncation, preserves UTF16 slicing and prefixes reserved names afterward', () => {
        for (const value of ['a'.repeat(179) + '😀x', 'a'.repeat(179) + '.x', 'CON.' + 'a'.repeat(200), 'a'.repeat(200) + '.. ']) {
            expect(podcastDownloadName(value)).toBe(original(value));
        }
        expect(podcastDownloadName('a'.repeat(179) + '.x')).toHaveLength(180);
        expect(podcastDownloadName('a'.repeat(179) + '.x')).toMatch(/\.$/);
        expect(podcastDownloadName('CON.' + 'a'.repeat(200))).toHaveLength(181);
    });
    it('handles a long failed suffix match and an entirely stripped name without truncating input first', () => {
        expect(podcastDownloadName('.'.repeat(40000) + 'x')).toBe('.'.repeat(180));
        expect(podcastDownloadName('. '.repeat(20000))).toBe('podcast.mp3');
    });
});
