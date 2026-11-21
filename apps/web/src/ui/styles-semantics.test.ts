import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('declares 44px targets, visible focus, distinct selection and no media filter', () => {
    const css = readFileSync('src/app/styles.css', 'utf8');
    expect(css).toMatch(/min-block-size:\s*44px/);
    expect(css).toMatch(/min-inline-size:\s*44px/);
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/aria-selected/);
    expect(css).not.toMatch(/grayscale\(|filter\s*:/);
});
