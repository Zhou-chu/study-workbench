import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn((query: string) => ({ matches: false, media: query, addEventListener() { }, removeEventListener() { } })) });

// Existing feature fixtures focus on their transport/operation owner. Artifact consumer tests unmock this seam.
vi.mock('../data/artifact', async importOriginal => {
 const actual=await importOriginal<typeof import('../data/artifact')>();
 return {...actual,createArtifactIdentity:()=>async()=>({schema_version:'spa-artifact-v1',source_commit:'a'.repeat(40),authored_digest:'b'.repeat(64),asset_digest:'c'.repeat(64),contract_digest:'d'.repeat(64),ui_transport_protocol:1,supported_contracts:['workspace-view-v1']})};
});
