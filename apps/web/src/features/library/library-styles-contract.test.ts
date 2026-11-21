import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('uses minimum 44px controls, visible focus and original media without grayscale filters', () => {
    const css = readFileSync('src/app/styles.css', 'utf8');
    expect(css).toMatch(/button, \.button, select, input \{ min-block-size: 44px; min-inline-size: 44px;/);
    expect(css).toMatch(/\.library-check input \{ width: 44px; min-width: 44px; height: 44px;/);
    expect(css).toMatch(/\.library-list a \{[^}]*min-height: 44px/);
    expect(css).toContain(':focus-visible { outline: 2px solid var(--focus)');
    expect(css).not.toMatch(/filter:\s*(?:grayscale|saturate)/);
    expect(css).not.toContain('mix-blend-mode');
});
