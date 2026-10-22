'use client'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { SourceProvenance as Provenance } from '@/lib/types/personal'

export function SourceProvenance({ provenance, compact = false }: { provenance: Provenance; compact?: boolean }) {
  const { t } = useTranslation()
  if (provenance.kind === 'web') {
    const url = provenance.source_url && /^https?:\/\//i.test(provenance.source_url) ? provenance.source_url : null
    return <div className="space-y-1 break-words text-xs leading-5 text-muted-foreground">{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline underline-offset-2">{url}</a> : <p>{t('webDiscovery.urlUnavailable')}</p>}{!compact && <time dateTime={provenance.retrieved_at}>{provenance.retrieved_at?.slice(0, 10)}</time>}</div>
  }
  const label = provenance.origin_kind === 'turn' || provenance.authorship === 'ai' ? 'sourceSnapshots.aiDerived' : 'sourceSnapshots.humanDerived'
  return <div className="space-y-1 text-xs leading-5 text-muted-foreground">
    <p className="inline-flex rounded border border-border px-1.5 font-medium text-cite-derived">{t('sourceSnapshots.derived')}</p>
    {!compact && <><p>{t(label)}</p><p>{t('sourceSnapshots.notIndependentEvidence')}</p></>}
    <details><summary className="cursor-pointer focus-visible:ring-2 focus-visible:ring-ring">{t('common.references')}</summary><div className="space-y-1 py-2">
      {compact && <><p>{t(label)}</p><p>{t('sourceSnapshots.notIndependentEvidence')}</p></>}
      <p className="break-words font-medium">{provenance.origin_title}</p>
      {provenance.note_revision != null && <p>{t('common.version')}: {provenance.note_revision}</p>}
      {provenance.authorship === 'unknown' && <p>{t('sourceSnapshots.unknownAuthorship')}</p>}
      <time dateTime={provenance.captured_at}>{provenance.captured_at?.slice(0, 10)}</time>
      {!!provenance.citations?.length && <ul className="space-y-1">{provenance.citations.map(reference => <li key={reference.citation_id}>{reference.source_title}</li>)}</ul>}
    </div></details>
  </div>
}
