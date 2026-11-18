import { expect, it } from 'vitest';
import { selection } from '../../test/source-fixtures';
import { includeImported, selectionFromView } from './source-selection';

it('explicit inclusion preserves reading and rejects more than twenty without truncation', () => { expect(includeImported(selection, ['v-new'])).toEqual({ ...selection, source_version_ids: ['v-old', 'v-new'] }); expect(() => includeImported({ ...selection, source_version_ids: Array.from({ length: 20 }, (_, i) => String(i)) }, ['new'])).toThrow(); expect(selectionFromView({ engine: 'future', selection_origin: 'local', source_version_ids: [], remote_source_ids: [] })).toBeNull(); });
