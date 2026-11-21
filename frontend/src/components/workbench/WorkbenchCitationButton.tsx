'use client'

import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { EvidenceCitation } from '@/lib/types/personal'

/** Display shortening never changes the citation, evidence, validity or locator. */
export function WorkbenchCitationButton({ citation, onOpen }: {
  citation: EvidenceCitation
  onOpen: (citation: EvidenceCitation) => void
}) {
  const { t } = useTranslation()
  const source = citation.source_title || t('workbench.unavailable')
  const fullLabel = `${source} · ${citation.citation_id}`
  const shortReference = citation.citation_id.length > 24
    ? `${citation.citation_id.slice(0, 10)}…${citation.citation_id.slice(-8)}`
    : citation.citation_id
  return <Button type="button" size="sm" variant="outline" className="workbench-citation gap-0.5 py-2" aria-label={fullLabel} title={fullLabel} onClick={() => onOpen(citation)}>
    <span className="line-clamp-2 min-w-0">{source}</span>
    <span className="text-xs text-muted-foreground" aria-hidden="true">{shortReference}</span>
  </Button>
}
