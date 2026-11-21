import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

it('has responsive three-area, dual/drawer and full-screen reader rules', () => {
    const css = readFileSync('src/app/styles.css', 'utf8');
    expect(css).toContain('min-width: 1280px');
    expect(css).toContain('min-width: 900px');
    expect(css).toContain('max-width: 899px');
    expect(css).toMatch(/data-reader-open="true"[^}]+workspace-studio[^}]+display:\s*none/s);
    expect(css).toContain('env(safe-area-inset-bottom)');
});
