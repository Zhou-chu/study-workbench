import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { routeCoverage, isCoverageComplete } from '../../app/route-coverage';
import { globalMessages } from '../../i18n/global-messages';
import { resources } from '../../i18n';
import { validScope, parseSearch, resultScore } from '../../data/global-search';
const operations = ["shell.navigate_search", "shell.command_search", "shell.command_ask", "global.switch_ask_search", "global.choose_notebook_scope", "global.clear_scope_to_whole_library", "global_search.submit", "global_search.text", "global_search.vector", "global_search.include_sources", "global_search.include_notes", "global_search.open_source", "global_search.open_note", "global_search.open_insight", "global_search.expand_matches", "global_search.view_score", "global_ask.submit", "global_ask.choose_strategy_model", "global_ask.choose_answer_model", "global_ask.choose_final_model", "global_ask.cancel_models", "global_ask.expand_strategy", "global_ask.expand_intermediate_answers", "global_ask.view_final", "global_ask.open_reference", "global_ask.save_to_selected_notebooks", "global_ask.cancel_save", "route.search", "route.search_link", "route.ask_link"];
it('registers exactly the 30 B8c operations as implemented, without claiming browser verification', () => {
    expect(new Set(operations).size).toBe(30);
    for (const operation of operations)
        expect(routeCoverage.find(r => r.coveredOperations.includes(operation))).toMatchObject({ ownerTask: 'B8', status: 'implemented' });
    // B8d is now implemented independently; retain the exact B8c operation checks above.
    expect(routeCoverage.filter(r => r.ownerTask === 'B8' && r.status === 'implemented')).toHaveLength(172);
    expect(routeCoverage.filter(r => r.ownerTask === 'B8' && r.status === 'pending')).toHaveLength(0);
    expect(isCoverageComplete(routeCoverage)).toBe(false);
    expect(routeCoverage.some(r => r.status === 'verified')).toBe(false);
});
it('every locale explicitly supplies global status and action labels', () => {
    expect(Object.keys(globalMessages).sort()).toEqual(Object.keys(resources).sort());
    expect(Object.keys(globalMessages)).toHaveLength(14);
    const keys = Object.keys(globalMessages['en-US']).sort();
    for (const value of Object.values(globalMessages)) {
        expect(Object.keys(value).sort()).toEqual(keys);
        expect(Object.values(value).every(v => typeof v === 'string' && v.trim())).toBe(true);
    }
    expect(readFileSync('src/app/styles.css', 'utf8')).toContain('.global-search summary { display: flex; align-items: center; min-height: 44px;');
});
it('raw search projections retain optional unknown fields without inventing result identities or scores', () => {
    const rows = [{ id: 'note:one:full', parent_id: 'note:one:full', title: null, custom: { original: true } }, { id: 'future:kind', relevance: 4 }, { id: 'source:full', similarity: .7 }];
    expect(parseSearch({ results: rows, total_count: 3, search_type: 'vector' }).results).toEqual(rows);
    expect(resultScore(rows[0]!)).toBeNull();
    expect(resultScore({ relevance: NaN, similarity: .7 })).toBe(.7);
    for (const ids of [[''], ['notebook:bad/path'], ['notebook:bad?query'], Array(51).fill('notebook:one')])
        expect(validScope(ids)).toBe(false);
    expect(validScope([])).toBe(true);
    expect(validScope(['notebook:alpha:full'])).toBe(true);
});
