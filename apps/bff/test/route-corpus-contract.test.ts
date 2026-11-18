import { expect, it } from 'vitest';
import { browserRoutes } from './route-corpus.js';

const examples = browserRoutes.flatMap(([methods, template, kind = 'json']) => methods.split(' ').map(method => ({ method, template, kind })));
it('freezes the full reviewed 153-entry corpus plus only two A1 additions', () => {
    expect(examples).toHaveLength(155);
    expect(examples.filter(x => x.template.endsWith('/workspace-view') || x.template === '/api/personal/client-capabilities')).toHaveLength(2);
});
