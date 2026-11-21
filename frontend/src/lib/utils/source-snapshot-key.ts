import type { SnapshotOrigin } from '@/lib/types/source-snapshots'

/** Reconstructible after reload; includes identities only, never note prose. */
export async function sourceSnapshotKey(notebookId: string, origin: SnapshotOrigin): Promise<string> {
  const version = 'source-snapshot-v1'
  const tuple = [version, notebookId, origin.kind, origin.id, origin.kind === 'note' ? origin.revision : null]
  const bytes = new TextEncoder().encode(JSON.stringify(tuple))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
  return `${version}:${hex}`
}
