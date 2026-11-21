import { expect, it } from 'vitest';
import type { SourceVersionView } from '@study/contracts';
import { sourceWorkspace } from '../../test/source-fixtures';
import { readySources } from './chat-admission';
function workspace(version: Partial<SourceVersionView>) {
    const w = sourceWorkspace();
    w.sources = [{ source_id: 's', versions: [{ source_version_id: 'v-old', ...version }] }];
    return w;
}
it('admits the real workspace producer status-only ready version', () => {
    expect(readySources(workspace({ status: 'ready' }), ['v-old'])).toBe(true);
});
it('admits agreeing explicit extraction status', () => {
    expect(readySources(workspace({ status: 'ready', extraction_status: 'ready' }), ['v-old'])).toBe(true);
});
it.each([{}, { status: null }, { status: 'future' }, { status: 'extracting' },
    { extraction_status: 'ready' }, { status: 'ready', extraction_status: null },
    { status: 'ready', extraction_status: 'extracting' },
    { status: 'ready', extraction_status: { projection_status: 'unknown' } },
    { status: { projection_status: 'unknown' }, extraction_status: 'ready' },
    { status: 'ready', projection_status: 'unknown' }])('fails closed for incomplete or conflicting readiness %j', version => {
    expect(readySources(workspace(version as Partial<SourceVersionView>), ['v-old'])).toBe(false);
});
it('keeps empty, missing, duplicate row and oversized selection guards', () => {
    const w = workspace({ status: 'ready' });
    expect(readySources(w, [])).toBe(false);
    expect(readySources(w, ['missing'])).toBe(false);
    expect(readySources(w, Array(21).fill('v-old'))).toBe(false);
    w.sources.push(w.sources[0]!);
    expect(readySources(w, ['v-old'])).toBe(false);
});
