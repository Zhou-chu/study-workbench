import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('retains a 44px minimum height for global search summary targets', () => {
    expect(readFileSync('src/app/styles.css', 'utf8')).toContain('.global-search summary { display: flex; align-items: center; min-height: 44px;');
});
