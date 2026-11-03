'use client'

import { OriginalEmbeddingDisclosure } from './OriginalEmbeddingDisclosure'
import { canReplayCapturedTurn } from '@/lib/workbench/turn-operations'
import { queryDisclosureIdentityFromRequest } from '@/lib/workbench/embedding-disclosure'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { useWorkbenchTurn } from '@/lib/hooks/use-workbench-turn'
import { stateKeys } from '@/lib/utils/workbench'

type Recovery = ReturnType<typeof useWorkbenchTurn>
export function TurnRecoveryPanel({ recovery }: { recovery: Recovery }) {
  const { t } = useTranslation()
  const { operation, ready, rejection } = recovery
  const rejectionKeys = { busy: 'workbench.turnRecoveryBusy', unavailable: 'workbench.turnRecoveryUnavailable', invalid: 'workbench.turnRecoveryInvalid', capacity: 'workbench.turnRecoveryCapacity', size: 'workbench.turnRecoverySize' }
  if (!operation) return rejection ? <p role="alert" className="text-sm text-muted-foreground">{t(rejectionKeys[rejection])}</p> : null
  const { dto, context } = operation.capture
  return <section aria-label={t('workbench.turnRecoveryTitle')} className="rounded-md border bg-card p-3 space-y-3 text-sm">
    <h3 className="font-medium">{t('workbench.turnRecoveryTitle')}</h3>
    <p role="status" className="text-teal">{operation.busy === 'post' ? t('workbench.asking') : operation.busy === 'check' ? t('workbench.turnRecoveryChecking') : t('workbench.turnRecoveryUncertain')}</p>
    {operation.observedState !== 'unknown' && <p>{t(stateKeys[operation.observedState])}</p>}
    <details className="space-y-2 text-xs text-muted-foreground">
      <summary>{t('workbench.turnRecoveryOriginal')}</summary>
      <dl className="space-y-1 break-words">
        <div><dt>{t('workbench.question')}</dt><dd className="whitespace-pre-wrap">{dto.message}</dd></div>
        <div><dt>{t('workbench.turnRecoveryTarget')}</dt><dd>{context.target.apiBase}</dd></div>
        <div><dt>{t('workbench.engine')}</dt><dd>{t(dto.engine === 'independent' ? 'workbench.independent' : 'workbench.notebooklm')}</dd></div>
        <div><dt>{t('workbench.turnScope')}</dt><dd>{[...dto.source_version_ids, ...dto.remote_source_ids].join(', ')}</dd></div>
        {dto.remote_notebook_id && <div><dt>{t('workbench.turnRecoveryRemoteNotebook')}</dt><dd>{dto.remote_notebook_id}</dd></div>}
      </dl>
    </details>
    {dto.engine === 'independent' && dto.task !== 'outline' && <OriginalEmbeddingDisclosure mode={dto.retrieval_mode === 'hybrid' ? 'hybrid' : 'lexical'} summary={operation.capture.embeddingDisclosure} identity={queryDisclosureIdentityFromRequest(dto)} sourceVersionIds={dto.source_version_ids} />}
    {recovery.readFailed && <p role="alert">{t('workbench.turnRecoveryReadFailed')}</p>}
    {!ready && <p role="status">{t('workbench.turnRecoveryUnavailable')}</p>}
    {operation.receipt ? <p className="text-muted-foreground">{t('workbench.turnRecoveryCheckOnly')}</p> : <p className="text-muted-foreground">{t('workbench.turnRecoveryRetryWarning')}</p>}
    {!operation.receipt && ready && !operation.busy && !recovery.replayAvailable && canReplayCapturedTurn(operation.capture) && <p>{t('workbench.turnRecoveryTargetChanged')}</p>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={!ready || !!operation.busy || operation.phase === 'complete'} onClick={recovery.checkOriginal}>{t('workbench.turnRecoveryCheck')}</Button>
      {!operation.receipt && <Button size="sm" variant="outline" disabled={!recovery.replayAvailable || !canReplayCapturedTurn(operation.capture)} onClick={recovery.retryOriginal}>{t('workbench.turnRecoveryRetry')}</Button>}
      {operation.phase === 'not-sent' && operation.postAttempts === 1 && !operation.everPossiblyDispatched && !operation.busy && <Button size="sm" variant="outline" onClick={recovery.abandonUnsent}>{t('workbench.turnRecoveryAbandon')}</Button>}
    </div>
    <p className="text-xs text-muted-foreground">{t('workbench.turnRecoveryDocumentOnly')}</p>
  </section>
}
