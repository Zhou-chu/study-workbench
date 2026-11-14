'use client'

import { useTranslation } from '@/lib/hooks/use-translation'
import type { TurnRecord } from '@/lib/types/personal'

export function TurnCoverage({ coverage, warnings, retrieval }: Pick<TurnRecord, 'coverage' | 'warnings' | 'retrieval'>) {
  const { t } = useTranslation()
  if (!coverage && !warnings?.length && !retrieval) return null
  return <div className="border-l-2 pl-3 space-y-1 text-xs text-muted-foreground">
    {retrieval && <>
      <p>{t('workbench.effectiveRetrieval', { method: t(retrieval.retrieval_method === 'hybrid' ? 'workbench.hybridMode' : retrieval.retrieval_method === 'selected_overview' ? 'workbench.selectedOverview' : 'workbench.lexicalOnly') })}</p>
      {retrieval.retrieval_method === 'lexical_fallback' && <p>{t('workbench.retrievalFallback', { reason: retrieval.fallback_reason ?? t('workbench.unavailable') })}</p>}
      <p>{t('workbench.retrievalCoverage', { indexed: retrieval.indexed_version_count, selected: retrieval.selected_version_count })}</p>
      {retrieval.warnings.map((warning, index) => <p key={`retrieval:${index}`}>{warning}</p>)}
    </>}
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
