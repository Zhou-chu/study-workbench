import { expect, it } from 'vitest';
import { evaluateCompatibility } from './session';
import type { SpaArtifactManifest } from '../../data/artifact';
const manifest: SpaArtifactManifest = {
    schema_version: 'spa-artifact-v1', source_commit: 'a'.repeat(40), authored_digest: 'b'.repeat(64), asset_digest: 'c'.repeat(64), contract_digest: 'd'.repeat(64), ui_transport_protocol: 1, supported_contracts: ['workspace-view-v1']
};
const config = {
    apiUrl: '', auth_mode: 'device_sessions', web_session_protocol: 'bff-memory-v1', client_contracts: ['workspace-view-v1'], ui_transport_protocol: 1
};
const capabilities = {
    contract_version: 'client-capabilities-v1', supported_contracts: ['workspace-view-v1'], limits: {
        source_upload_max_bytes: 50, portable: {
            max_archive_bytes: 10, max_expanded_bytes: 20, max_entity_bytes: 10, max_manifest_bytes: 10, max_request_bytes: 30, multipart_overhead_bytes: 10, max_entries: 2, max_compression_ratio: 5
        }
    }
};

it.each([null, {}, {
        ...manifest, ui_transport_protocol: 2
    }])('rejects absent or invalid local artifact %j', local => {
    expect(evaluateCompatibility(local, config, capabilities)).toBe(local === null ? 'unavailable' : 'blocked');
});

it.each([{
        ...config, apiUrl: 'https://other.invalid'
    }, {
        ...config, auth_mode: 'future'
    }, {
        ...config, web_session_protocol: null
    }])('rejects incompatible runtime %j', runtime => {
    expect(evaluateCompatibility(manifest, runtime, capabilities)).toBe('blocked');
});

it('rejects malformed API capabilities rather than assuming compatibility', () => {
    expect(evaluateCompatibility(manifest, config, {})).toBe('blocked');
});
