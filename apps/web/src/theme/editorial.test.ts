import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
const base = 'src/theme';
it('ships self-hosted serif and sans faces instead of relying on installed CJK fonts', () => {
 const css = readFileSync(base + '/fonts/fonts.css','utf8');
 expect(css).toContain('Noto Serif SC Variable');
 expect(css).toContain('Noto Sans SC Variable');
 expect(css).toContain('Source Serif 4 Variable');
 const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(x => x[1]!.replace(/['"]/g,''));
 expect(urls.length).toBeGreaterThan(2);
 for (const url of urls) { expect(url).not.toMatch(/^https?:/); expect(existsSync(path.join(base, 'fonts', url))).toBe(true); }
 expect(css).toContain('font-display: swap');
 expect(css).toContain('SIL OPEN FONT LICENSE');
 for(const name of ['noto-serif-sc','noto-sans-sc','source-serif-4']) expect(existsSync('public/fonts/licenses/'+name+'-LICENSE.txt')).toBe(true);
});
it('uses explicit reading and utility scales, including h3, and constrained reading width', () => {
 const tokens = readFileSync(base + '/tokens.css', 'utf8');
 const css = readFileSync(base + '/editorial.css','utf8');
 for(const name of ['--type-meta','--type-ui','--type-body','--type-section','--type-title','--reading-measure']) expect(tokens).toContain(name);
 expect(css).toMatch(/h3\s*\{[^}]*font-size:\s*var\(--type-section\)/);
 expect(css).toMatch(/\.chat-message\s*\{[^}]*max-width:\s*var\(--reading-measure\)/);
 expect(css).toContain('font-family: var(--reading-font)');
 expect(css).toContain('min-height: 44px');
 expect(css).toContain('@media (max-width: 899px)');
 // Floating layers may use backdrop-filter; content filters remain prohibited.
 expect(css).not.toMatch(/(?:^|[;{]\s*)filter\s*:|display:\s*none/);
 expect(css).not.toMatch(/letter-spacing:\s*-/);
});

it('keeps auxiliary and semantic status text accessible in both themes', () => {
 const text = readFileSync(base + '/tokens.css','utf8');
 const blocks=[...text.matchAll(/:root[^}]*\{([^}]+)\}/g)].map(m=>Object.fromEntries([...m[1]!.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map(x=>[x[1]!,x[2]!])));
 const lum=(hex:string)=>{const c=hex.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]!+.7152*c[1]!+.0722*c[2]!};
 for(const b of blocks) for(const fg of ['text','muted','auxiliary','error','warning','success']) for(const bg of ['background','surface','selected']) { const a=lum(b[fg]!),c=lum(b[bg]!);expect((Math.max(a,c)+.05)/(Math.min(a,c)+.05),fg+'/'+bg).toBeGreaterThanOrEqual(4.5); }
});
