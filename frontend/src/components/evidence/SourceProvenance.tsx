'use client'
import { useTranslation } from '@/lib/hooks/use-translation'

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function date(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

export function SourceProvenance({ provenance, compact = false }: { provenance: unknown; compact?: boolean }) {
  const { t } = useTranslation()
  const value = object(provenance)
  if (value?.kind === 'web') {
    const url = typeof value.source_url === 'string' && /^https?:\/\//i.test(value.source_url) ? value.source_url : null
    const retrieved = date(value.retrieved_at)
    return <div className="space-y-1 break-words text-xs leading-5 text-muted-foreground">{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline underline-offset-2">{url}</a> : <p>{t('webDiscovery.urlUnavailable')}</p>}{!compact && (retrieved ? <time dateTime={retrieved}>{retrieved.slice(0, 10)}</time> : <p>{t('workbench.unavailable')}</p>)}</div>
  }
  // Future/opaque provenance is neither a human-derived source nor independent evidence.
  if (value?.kind !== 'derived' || (value.origin_kind !== 'note' && value.origin_kind !== 'turn') || !['ai', 'human', 'unknown'].includes(typeof value.authorship === 'string' ? value.authorship : '')) {
    return <p className="text-xs leading-5 text-muted-foreground">{t('workbench.unavailable')}</p>
  }
  const label = value.origin_kind === 'turn' || value.authorship === 'ai' ? 'sourceSnapshots.aiDerived' : value.authorship === 'human' ? 'sourceSnapshots.humanDerived' : 'sourceSnapshots.unknownAuthorship'
  const captured = date(value.captured_at)
  const citations = Array.isArray(value.citations) ? value.citations : []
  return <div className="space-y-1 text-xs leading-5 text-muted-foreground">
    <p className="inline-flex rounded border border-border px-1.5 font-medium text-cite-derived">{t('sourceSnapshots.derived')}</p>
    {!compact && <><p>{t(label)}</p><p>{t('sourceSnapshots.notIndependentEvidence')}</p></>}
    <details><summary className="cursor-pointer focus-visible:ring-2 focus-visible:ring-ring">{t('common.references')}</summary><div className="space-y-1 py-2">
      {compact && <><p>{t(label)}</p><p>{t('sourceSnapshots.notIndependentEvidence')}</p></>}
      <p className="break-words font-medium">{typeof value.origin_title === 'string' ? value.origin_title : t('workbench.unavailable')}</p>
      {typeof value.note_revision === 'number' && Number.isSafeInteger(value.note_revision) && value.note_revision >= 1 && <p>{t('common.version')}: {value.note_revision}</p>}
      {captured ? <time dateTime={captured}>{captured.slice(0, 10)}</time> : <p>{t('workbench.unavailable')}</p>}
      {!!citations.length && <ul className="space-y-1">{citations.map((reference, index) => {
        const item = object(reference)
        return <li key={index}>{typeof item?.source_title === 'string' ? item.source_title : t('workbench.unavailable')}</li>
      })}</ul>}
    </div></details>
  </div>
}
