'use client'

import { SourceProvenance } from '@/components/evidence/SourceProvenance'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { EvidenceRecord } from '@/lib/types/personal'

export function WorkbenchSearchResult({ hit, versionLabel, onOpen }: {
  hit: EvidenceRecord
  versionLabel: string
  onOpen: (hit: EvidenceRecord) => void
}) {
  const { t } = useTranslation()
  const pageIndex = hit.locator?.page_index
  const physicalPage = typeof pageIndex === 'number' && Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex + 1 : null
  const kindLabel = hit.evidence_kind === 'derived_snapshot' ? 'sourceSnapshots.derived' : hit.evidence_kind === 'remote_text_snapshot' ? 'workbench.evidenceRemoteSnapshot' : ['pdf_text', 'text', 'local_evidence'].includes(hit.evidence_kind ?? '') ? 'workbench.evidenceLocal' : 'workbench.unavailable'
  const derived = hit.evidence_kind === 'derived_snapshot' || hit.provenance?.kind === 'derived' || hit.independent_support === false
  return <article className="min-w-0 space-y-2 rounded border p-2 text-xs [overflow-wrap:anywhere]">
    <button type="button" className="block min-w-0 w-full space-y-1.5 rounded-sm text-left [overflow-wrap:anywhere] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(hit)}>
      <span className="block min-w-0 font-medium [overflow-wrap:anywhere]">{hit.source_title || hit.source_version_id}</span>
      <span className="block min-w-0 whitespace-pre-wrap leading-5 [overflow-wrap:anywhere]">{hit.quote}</span>
      {physicalPage !== null && <span className="block min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{t('workbench.physicalPage', { page: physicalPage })}</span>}
      {hit.locator?.page_label && <span className="block min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{t('workbench.printPage', { label: hit.locator.page_label })}</span>}
      <span className="block min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{t('common.version')}: <span>{versionLabel}</span></span>
      <span className="block min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{t(kindLabel)}</span>
      {derived && <span className="block min-w-0 text-cite-derived [overflow-wrap:anywhere]">{t('sourceSnapshots.notIndependentEvidence')}</span>}
    </button>
    {hit.provenance != null && <div className="min-w-0 [overflow-wrap:anywhere]"><SourceProvenance provenance={hit.provenance} /></div>}
  </article>
}
