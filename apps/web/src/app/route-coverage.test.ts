import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { routeCoverage, isCoverageComplete, type RouteCoverageEntry } from './route-coverage';
const entry: RouteCoverageEntry = { legacyPath: '/sources', newPath: '/sources', ownerTask: 'B8', status: 'pending', coveredOperations: ['library.list'] };
it('does not count pending or implemented placeholders as completed coverage', () => {
    expect(isCoverageComplete([entry])).toBe(false);
    expect(isCoverageComplete([{ ...entry, status: 'implemented' }])).toBe(false);
    expect(isCoverageComplete([{ ...entry, status: 'verified', evidence: 'fixture' }])).toBe(true);
    expect(isCoverageComplete([])).toBe(false);
    expect(isCoverageComplete([{ ...entry, status: 'verified' }])).toBe(false);
    expect(isCoverageComplete([{ ...entry, status: 'verified', evidence: 'x', coveredOperations: [] }])).toBe(false);
});
it('explicitly retains every public path, deep-link and actual advanced/classic operation family', () => {
    const paths = routeCoverage.map(e => e.legacyPath);
    for (const path of ['/', '/login', '/notebooks', '/notebooks/:id', '/notebooks/:id/study', '/sources', '/sources/:id', '/search', '/search?q=:query&mode=search', '/search?q=:query&mode=ask', '/podcasts', '/settings', '/settings#web-search', '/settings/models', '/transformations', '/advanced'])
        expect(paths).toContain(path);
    const operations = routeCoverage.flatMap(e => e.coveredOperations);
    expect(new Set(operations).size).toBe(operations.length);
    expect(operations.length).toBeGreaterThan(300);
    for (const op of ['classic.chat.send', 'classic.sessions.rename', 'conversation.read_classic_history', 'source.associate_notebooks', 'episode_profiles.duplicate', 'speaker_profiles.add_speaker', 'credentials.migrate_from_env', 'models.assign_embedding', 'advanced.start_rebuild', 'index.recover_original', 'evidence.revalidate_restored', 'notebooks.keep_exclusive_sources', 'notebooks.delete_exclusive_sources', 'podcasts.download'])
        expect(operations).toContain(op);
    expect(routeCoverage.filter(e => e.ownerTask === 'B3' && e.status === 'pending')).toEqual([]);
    expect(isCoverageComplete(routeCoverage)).toBe(false);
    expect(routeCoverage.some(e => e.status === 'verified')).toBe(false);
});
it('keeps lifecycle writes and unfinished study/classic/advanced features pending with real owners and matches the human inventory', () => {
    const doc = readFileSync('../../docs/v1/SPA_ROUTE_COVERAGE.md', 'utf8');
    for (const row of routeCoverage) {
        expect(row.ownerTask.trim()).toBeTruthy();
        expect(row.coveredOperations.length).toBeGreaterThan(0);
        for (const op of row.coveredOperations)
            expect(doc, op).toContain('`' + op + '`');
    }
    for (const op of ['notebooks.archive', 'notebooks.unarchive', 'notebooks.preview_delete', 'notebooks.confirm_delete', 'notebooks.keep_exclusive_sources', 'notebooks.delete_exclusive_sources', 'notebooks.cancel_delete'])
        expect(routeCoverage.find(e => e.coveredOperations.includes(op))).toMatchObject({ ownerTask: 'B9', status: 'pending' });
    for (const op of ['credentials.create', 'advanced.start_rebuild'])
        expect(routeCoverage.find(e => e.coveredOperations.includes(op))?.status).toBe('pending');
});
it('records actual recent-source detail wiring without reassigning B2 authentication', () => { expect(routeCoverage.find(e => e.coveredOperations.includes('notebooks.open_recent_source'))).toMatchObject({ ownerTask: 'B8', status: 'implemented' }); expect(routeCoverage.find(e => e.coveredOperations.includes('auth.login'))).toMatchObject({ ownerTask: 'B2', status: 'implemented' }); });
it('retains the 70 B8a source operations and 29 B8b classic operations without claiming later slices', () => {
    const doc = readFileSync('../../docs/v1/B8A_SOURCE_ACCEPTANCE.md', 'utf8');
    const allocated = [...doc.matchAll(/^\| \x60([a-z0-9_.]+)\x60 \|/gm)].map(m => m[1]);
    expect(allocated).toHaveLength(70);
    expect(new Set(allocated).size).toBe(70);
    const classicDoc = readFileSync('../../docs/v1/B8B_CLASSIC_ACCEPTANCE.md', 'utf8');
    const classic = [...classicDoc.matchAll(/^\| \x60([a-z0-9_.]+)\x60 \|/gm)].map(m => m[1]);
    expect(classic).toHaveLength(29);
    expect(new Set(classic).size).toBe(29);
    const b8 = routeCoverage.filter(r => r.ownerTask === 'B8');
    expect(b8).toHaveLength(172);
    for (const row of b8)
        expect(row.status).toBe(row.coveredOperations.some(op => allocated.includes(op) || classic.includes(op)) ? 'implemented' : 'pending');
    expect(b8.filter(r => r.status === 'pending')).toHaveLength(73);
    expect(isCoverageComplete(routeCoverage)).toBe(false);
});
