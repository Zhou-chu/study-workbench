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
it('records B9a lifecycle source implementation and keeps later B9 features pending with real owners', () => {
    const doc = readFileSync('../../docs/v1/SPA_ROUTE_COVERAGE.md', 'utf8');
    for (const row of routeCoverage) {
        expect(row.ownerTask.trim()).toBeTruthy();
        expect(row.coveredOperations.length).toBeGreaterThan(0);
        for (const op of row.coveredOperations)
            expect(doc, op).toContain('`' + op + '`');
    }
    for (const op of ['notebooks.archive', 'notebooks.unarchive', 'notebooks.preview_delete', 'notebooks.confirm_delete', 'notebooks.keep_exclusive_sources', 'notebooks.delete_exclusive_sources', 'notebooks.cancel_delete'])
        expect(routeCoverage.find(e => e.coveredOperations.includes(op))).toMatchObject({ ownerTask: 'B9', status: 'implemented' });
    for (const op of ['transformations.create'])
        expect(routeCoverage.find(e => e.coveredOperations.includes(op))?.status).toBe('pending');
});
it('records actual recent-source detail wiring without reassigning B2 authentication', () => { expect(routeCoverage.find(e => e.coveredOperations.includes('notebooks.open_recent_source'))).toMatchObject({ ownerTask: 'B8', status: 'implemented' }); expect(routeCoverage.find(e => e.coveredOperations.includes('auth.login'))).toMatchObject({ ownerTask: 'B2', status: 'implemented' }); });
it('retains all172 B8 operations across the four implemented slices without claiming browser verification', () => {
    const doc = readFileSync('../../docs/v1/B8A_SOURCE_ACCEPTANCE.md', 'utf8');
    const allocated = [...doc.matchAll(/^\| \x60([a-z0-9_.]+)\x60 \|/gm)].map(m => m[1]);
    expect(allocated).toHaveLength(70);
    expect(new Set(allocated).size).toBe(70);
    const classicDoc = readFileSync('../../docs/v1/B8B_CLASSIC_ACCEPTANCE.md', 'utf8');
    const classic = [...classicDoc.matchAll(/^\| \x60([a-z0-9_.]+)\x60 \|/gm)].map(m => m[1]);
    expect(classic).toHaveLength(29);
    expect(new Set(classic).size).toBe(29);
    const globalDoc = readFileSync('../../docs/v1/B8C_GLOBAL_ACCEPTANCE.md', 'utf8');
    const global = [...globalDoc.matchAll(/^\| \x60([a-z0-9_.]+)\x60 \|/gm)].map(m => m[1]);
    expect(global).toHaveLength(30);
    expect(new Set(global).size).toBe(30);
    const podcastDoc=readFileSync('../../docs/v1/B8D_PODCAST_ACCEPTANCE.md','utf8');
    const podcast=[...podcastDoc.matchAll(/^\| `([a-z0-9_.]+)` \|/gm)].map(m=>m[1]);
    expect(podcast).toHaveLength(43);expect(new Set(podcast).size).toBe(43);
    const b8 = routeCoverage.filter(r => r.ownerTask === 'B8');
    expect(b8).toHaveLength(172);
    for (const row of b8)
        expect(row.status).toBe(row.coveredOperations.some(op => allocated.includes(op) || classic.includes(op) || global.includes(op) || podcast.includes(op)) ? 'implemented' : 'pending');
    expect(b8.filter(r => r.status === 'pending')).toHaveLength(0);
    expect(isCoverageComplete(routeCoverage)).toBe(false);
});

it('retains B9a33 B9b12 B9c50 and exact B9d16 without completing B9e or browser gates',()=>{
 const doc=readFileSync('../../docs/v1/B9A_SESSION_ACCEPTANCE.md','utf8');
 const owned=[...doc.matchAll(/^\| `([a-z0-9_.]+)` \|/gm)].map(m=>m[1]);
 expect(owned).toHaveLength(33);expect(new Set(owned).size).toBe(33);
 const b9=routeCoverage.filter(r=>r.ownerTask==='B9');expect(b9).toHaveLength(129);
 const advancedDoc=readFileSync('../../docs/v1/B9B_ADVANCED_ACCEPTANCE.md','utf8');const advanced=[...advancedDoc.matchAll(/^\| `([a-z0-9_.]+)` \|/gm)].map(m=>m[1]);expect(advanced).toHaveLength(12);expect(new Set(advanced).size).toBe(12);
 const configurationDoc=readFileSync('../../docs/v1/B9C_CONFIGURATION_ACCEPTANCE.md','utf8');const configuration=[...configurationDoc.matchAll(/^\| \`([a-z0-9_.]+)\` \|/gm)].map(m=>m[1]);expect(configuration).toHaveLength(50);expect(new Set(configuration).size).toBe(50);
 const retrieval=["retrieval.choose_lexical", "retrieval.choose_hybrid", "retrieval.choose_profile", "retrieval.acknowledge_query_destination", "index.preview", "index.cancel_preview", "index.acknowledge_document_destination", "index.acknowledge_duplicate_cost", "index.confirm_build", "index.refresh", "index.recover_original", "index.cancel_waiting", "index.retry_full_version", "evidence.reparse", "evidence.revalidate_restored", "evidence.refresh_maintenance_job"];
 for(const row of b9)expect(row.status).toBe(row.coveredOperations.some(op=>owned.includes(op)||advanced.includes(op)||configuration.includes(op)||retrieval.includes(op))?'implemented':'pending');
 expect(b9.filter(r=>r.status==='pending')).toHaveLength(18);
});

it('B9d contributes exactly 16 source operations while transformations and all browser acceptance remain pending',()=>{const operations=['retrieval.choose_lexical','retrieval.choose_hybrid','retrieval.choose_profile','retrieval.acknowledge_query_destination','index.preview','index.cancel_preview','index.acknowledge_document_destination','index.acknowledge_duplicate_cost','index.confirm_build','index.refresh','index.recover_original','index.cancel_waiting','index.retry_full_version','evidence.reparse','evidence.revalidate_restored','evidence.refresh_maintenance_job'];expect(new Set(operations).size).toBe(16);for(const op of operations){const rows=routeCoverage.filter(r=>r.ownerTask==='B9'&&r.coveredOperations.includes(op));expect(rows).toHaveLength(1);expect(rows[0]!.status).toBe('implemented');}expect(routeCoverage.filter(r=>r.ownerTask==='B9'&&r.status==='implemented')).toHaveLength(111);});
