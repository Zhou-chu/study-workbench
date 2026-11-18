import { expect, it } from 'vitest';
import { isCoverageComplete, type RouteCoverageEntry } from './route-coverage';
const entry: RouteCoverageEntry = { legacyPath: '/sources', newPath: '/sources', ownerTask: 'B8', status: 'pending', coveredOperations: ['library.list'] };

it('does not count pending or implemented placeholders as completed coverage', () => {
    expect(isCoverageComplete([entry])).toBe(false);
    expect(isCoverageComplete([{ ...entry, status: 'implemented' }])).toBe(false);
    expect(isCoverageComplete([{ ...entry, status: 'verified', evidence: 'fixture' }])).toBe(true);
    expect(isCoverageComplete([])).toBe(false);
    expect(isCoverageComplete([{ ...entry, status: 'verified' }])).toBe(false);
    expect(isCoverageComplete([{ ...entry, status: 'verified', evidence: 'x', coveredOperations: [] }])).toBe(false);
});
