import type { ReadingPosition, WorkbenchSelectionView, WorkbenchVersionView } from '@/lib/types/personal'

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function nonemptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}
function ids(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(id => nonemptyString(id) !== null) ? [...value] : null
}
function readingPosition(value: unknown): ReadingPosition | null {
  const item = record(value)
  if (!item || !nonemptyString(item.source_version_id) || !Number.isSafeInteger(item.page_index) || (item.page_index as number) < 0) return null
  if (item.evidence_id !== undefined && !nonemptyString(item.evidence_id)) return null
  return { source_version_id: item.source_version_id as string, page_index: item.page_index as number, ...(item.evidence_id === undefined ? {} : { evidence_id: item.evidence_id as string }) }
}

/** A rendering projection, not a validated request or a replacement for raw Query data. */
export function projectWorkbenchSelection(value: unknown): WorkbenchSelectionView {
  // Only the complete null selection means "not yet selected". Missing fields
  // within a retained object must not acquire defaults that authorize a scope.
  const item = value === null ? { engine: 'notebooklm', selection_origin: 'local', source_version_ids: [], remote_source_ids: [] } : record(value)
  const local = ids(item?.source_version_ids)
  const remote = ids(item?.remote_source_ids)
  return {
    engine: item?.engine,
    selection_origin: item?.selection_origin,
    source_version_ids: local ?? [],
    remote_source_ids: remote ?? [],
    reading: readingPosition(item?.reading),
    supported: local !== null && remote !== null && (item?.engine === 'independent' || item?.engine === 'notebooklm') && (item?.selection_origin === 'local' || item?.selection_origin === 'remote'),
  }
}

function versionDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null
  const day = value.slice(0, 10)
  const midnight = Date.parse(`${day}T00:00:00Z`)
  // Date.parse rolls impossible dates forward. Never use that as ordering proof.
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day || !Number.isFinite(Date.parse(value))) return null
  return value
}

export function projectWorkbenchVersion(value: unknown): WorkbenchVersionView {
  const item = record(value)
  return {
    source_version_id: nonemptyString(item?.source_version_id),
    created_at: versionDate(item?.created_at),
    origin: nonemptyString(item?.origin),
    status: nonemptyString(item?.status),
    extraction_status: nonemptyString(item?.extraction_status),
    original_status: nonemptyString(item?.original_status),
    provenance: item?.provenance,
  }
}

/** Ambiguous ordering/identity grants no automatic selection; manual valid IDs remain usable. */
export function newestSelectableVersionId(versions: readonly WorkbenchVersionView[]): string | null {
  if (!versions.length) return null
  const seen = new Set<string>()
  let latest: string | null = null
  let latestTime = -Infinity
  let tied = false
  for (const version of versions) {
    const id = nonemptyString(version.source_version_id)
    const date = versionDate(version.created_at)
    if (!id || !date || seen.has(id)) return null
    seen.add(id)
    const time = Date.parse(date)
    if (time > latestTime) { latest = id; latestTime = time; tied = false }
    else if (time === latestTime) tied = true
  }
  return tied ? null : latest
}
