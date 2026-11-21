import { sourceWorkspace } from './source-fixtures';
export const legacySource = { id: 'source:alpha:full', title: 'Historical paper', topics: ['history'], asset: { file_path: '/private/upload/paper.txt', url: 'https://www.youtube.com/watch?v=abcdefghijk' }, embedded: false, embedded_chunks: 0, insights_count: 1, created: '2026-11-08T10:00:00Z', updated: '2026-11-08T10:01:00Z', file_available: true, command_id: null, status: null, processing_info: null };
export const sourceDetail = { ...legacySource, full_text: 'Original source body', notebooks: ['n'] };
export const insight = { id: 'source_insight:first:full', source_id: legacySource.id, insight_type: 'Summary', content: 'Preserved insight', created: null, updated: null };
export const notebook = { id: 'n', name: 'Synthetic notebook', description: '', archived: false, created: '2026-11-08', updated: '2026-11-08', source_count: 1, note_count: 0 };
export function libraryWorkspace() { return { ...sourceWorkspace(), sources: [{ source_id: legacySource.id, title: legacySource.title, versions: [] }] }; }
