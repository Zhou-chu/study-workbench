import type { Workspace } from '@/lib/types/personal'
import { projectWorkbenchVersion } from './workbench-read-model'

export type SelectedSourceBlocker = { versionId: string; title: string | null; status: string | null; reason: 'not-ready' | 'missing' | 'ambiguous' }
type Match = { title: string | null; status: string | null }
function sourceMatches(sources: Workspace['sources'] | undefined): Map<string, Match[]> {
  const matches = new Map<string, Match[]>()
  for (const source of sources ?? []) {
    for (const raw of source.versions) {
      const version = projectWorkbenchVersion(raw)
      if (version.source_version_id === null) continue
      const entries = matches.get(version.source_version_id) ?? []
      entries.push({ title: typeof source.title === 'string' ? source.title : null, status: version.status })
      matches.set(version.source_version_id, entries)
    }
  }
  return matches
}
/** Display projections and extraction fallback never authorize local retrieval. */
export function selectedSourceBlockers(ids: readonly string[], sources: Workspace['sources'] | undefined): SelectedSourceBlocker[] {
  const matches = sourceMatches(sources)
  return [...new Set(ids)].flatMap(versionId => {
    const entries = matches.get(versionId) ?? []
    if (entries.length === 1 && (entries[0].status === 'ready' || entries[0].status === 'partial')) return []
    return [{ versionId, title: entries[0]?.title ?? null, status: entries.length === 1 ? entries[0].status : null, reason: entries.length === 0 ? 'missing' as const : entries.length > 1 ? 'ambiguous' as const : 'not-ready' as const }]
  })
}
/** Only selected identities, authoritative statuses and match counts own search results. */
export function selectedSourceReadinessFingerprint(ids: readonly string[], sources: Workspace['sources'] | undefined): string {
  const matches = sourceMatches(sources)
  return JSON.stringify(ids.map(id => {
    const entries = matches.get(id) ?? []
    return [id, entries.length === 1 ? entries[0].status : null, entries.length]
  }))
}
