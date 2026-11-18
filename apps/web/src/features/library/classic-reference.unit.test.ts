import { expect, it } from 'vitest';
import { recordReferences } from './RecordReference';

it('preserves full opaque reference identity', () => {
    expect(recordReferences('[source:multi:with-hyphen] insight:a:b, source:bad/path source:bad%2fpath https://x/source:bad')).toEqual([{ kind: 'source', id: 'source:multi:with-hyphen' }, { kind: 'source_insight', id: 'source_insight:a:b' }]);
});
