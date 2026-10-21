'use client'

import { useTranslation } from '@/lib/hooks/use-translation'
import type { TurnRecord } from '@/lib/types/personal'

export function TurnCoverage({ coverage, warnings }: Pick<TurnRecord, 'coverage' | 'warnings'>) {
  const { t } = useTranslation()
  if (!coverage && !warnings?.length) return null
  return <div className="border-l-2 pl-3 space-y-1 text-xs text-muted-foreground">
    {coverage && <>
      <p className="font-medium">{t('workbench.coverageSummary', { selected: coverage.selected_source_count, retrieved: coverage.retrieved_source_count, evidence: coverage.evidence_count })}</p>
      <p>{t('workbench.coverageExcerptOnly')}</p>
    </>}
    {warnings?.map((warning, index) => {
      const code = warning.split(':', 1)[0]
      const message = code === 'BOUNDED_OVERVIEW' ? t('workbench.boundedOutline')
        : code === 'PARTIAL_SOURCE_COVERAGE' || code === 'PARTIAL_COVERAGE' ? t('workbench.partialCoverage')
          : code === 'CONTEXT_BUDGET' ? t('workbench.contextBudget') : warning
      return <p key={`${code}:${index}`}>{message}</p>
    })}
  </div>
}
