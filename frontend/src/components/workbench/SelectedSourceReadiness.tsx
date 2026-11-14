'use client'

import { useTranslation } from '@/lib/hooks/use-translation'
import { stateKeys } from '@/lib/utils/workbench'
import type { SelectedSourceBlocker } from '@/lib/utils/workbench-readiness'

/** Scope changes stay with the existing source checkboxes, never implicit filtering. */
export function SelectedSourceReadiness({ blockers }: { blockers: readonly SelectedSourceBlocker[] }) {
  const { t } = useTranslation()
  if (!blockers.length) return null
  return <div role="status" className="min-w-0 space-y-1 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
    <p>{t('workbench.selectedSourcesBlocked')}</p>
    <ul className="space-y-1">{blockers.map(blocker => <li key={blocker.versionId} className="min-w-0">
      {blocker.title !== null && <><span>{blocker.title}</span>{' · '}</>}<span>{blocker.versionId}</span>{' — '}<span>{t(blocker.reason === 'missing' ? 'workbench.selectedSourceMissing' : blocker.reason === 'ambiguous' ? 'workbench.selectedSourceAmbiguous' : blocker.status && Object.hasOwn(stateKeys, blocker.status) ? stateKeys[blocker.status] : 'workbench.unavailable')}</span>
      {blocker.reason === 'not-ready' && blocker.status === 'empty' && <p>{t('workbench.emptySourceHint')}</p>}
      {blocker.reason === 'not-ready' && blocker.status === 'needs_ocr' && <p>{t('workbench.selectedSourceOcrHint')}</p>}
    </li>)}</ul>
    <p>{t('workbench.selectedSourcesWaitOrDeselect')}</p>
  </div>
}
