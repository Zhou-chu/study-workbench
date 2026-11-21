import { describe, expect, it } from 'vitest';
import { parseScope, parseCitation, parseLocalArtifact, parsePortableImport, StudioError } from './studio-api';
const citation = { citation_id: 'c', kind: 'local_evidence', source_version_id: 'v', evidence_id: 'e', source_title: 'Source', quote: 'Evidence', reference_validity: 'verified' };
describe('studio receipt boundaries', () => {
  it.each([null, [], 'scope', { projection_status: 'unknown' }, { source_version_ids: 'v' }, { source_version_ids: [''] }, { source_version_ids: [], engine: 'future' }, { source_version_ids: [], selection_origin: 'future' }, { source_version_ids: [], mapping_version: -1 }, { source_version_ids: [], mapping_version: 0.5 }])('rejects malformed scope %j', value => {
    expect(() => parseScope(value)).toThrow(StudioError);
  });
  it('retains exact optional scope metadata including explicit nulls', () => {
    const scope = { source_version_ids: ['v'], engine: 'notebooklm', selection_origin: 'remote', remote_source_ids: ['r'], remote_notebook_id: null, scope_hash: '', mapping_version: 0, mappings: [{ source_link_id: null, remote_source_id: 'r', source_version_id: 'v', mapping_method: null, last_checked_at: null }] };
    expect(parseScope(scope)).toEqual(scope);
  });
  it.each([{ kind: 'future' }, { citation_id: '' }, { independent_support: 1 }, { remote_reference: [] }, { locator: { page_index: -1 } }, { locator: { bbox: [Infinity] } }, { locator: { page_label: 1 } }, { locator: { unknown: true } }, { reason: 2 }])('rejects invalid citation field %j', patch => {
    expect(() => parseCitation({ ...citation, ...patch })).toThrow(StudioError);
  });
  it('preserves valid locator and web provenance but returns an independent copy', () => {
    const source = { ...citation, independent_support: false, locator: { page_index: 0, page_label: 'i', block_id: 'b', start_offset: 0, end_offset: 1, bbox: [0, 0, 1, 1] }, provenance: { kind: 'web', provider: 'firecrawl', source_url: null, retrieved_at: '2026-11-13', search_result_title: null, search_result_snippet: 'text', historical_url_omitted: true } };
    const result = parseCitation(source);
    expect(result).toEqual(source);
    expect(result).not.toBe(source);
    expect(result.locator).not.toBe(source.locator);
  });
  it.each([{ provider: 'other' }, { historical_url_omitted: 'yes' }, { search_result_title: 1 }, { extra: true }])('rejects malformed web provenance %j', patch => {
    expect(() => parseCitation({ ...citation, provenance: { kind: 'web', provider: 'firecrawl', source_url: null, retrieved_at: '', ...patch } })).toThrow(StudioError);
  });
  const artifact = { artifact_id: 'a:1', notebook_id: 'n', mime_type: 'audio/wav', byte_size: 0, sha256: 'a'.repeat(64), title: 'Audio', kind: 'audio' };
  it('accepts zero-byte metadata without inferring playback success', () => {
    expect(parseLocalArtifact(artifact, 'n')).toEqual(artifact);
  });
  it.each([{ notebook_id: 'other' }, { sha256: 'bad' }, { artifact_id: '../private' }, { byte_size: -1 }, { byte_size: 0.5 }])('rejects artifact identity or integrity mismatch %j', patch => {
    expect(() => parseLocalArtifact({ ...artifact, ...patch }, 'n')).toThrow(StudioError);
  });
  const receipt = { notebook_id: 'new', id_map: { old: 'fresh' }, entity_counts: { notes: 0 }, missing: [], warnings: ['Original unavailable'] };
  it('retains import warnings without mutating the source receipt', () => {
    const result = parsePortableImport(receipt, 'original');
    expect(result).toEqual(receipt);
    result.warnings.push('local');
    expect(receipt.warnings).toHaveLength(1);
  });
  it.each([{ notebook_id: 'original' }, { id_map: { old: 'old' } }, { entity_counts: { notes: -1 } }, { missing: null }, { warnings: 'warning' }])('rejects unsafe or incomplete import receipt %j', patch => {
    expect(() => parsePortableImport({ ...receipt, ...patch }, 'original')).toThrow(StudioError);
  });
});
