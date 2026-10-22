'use client'
import { Globe2 } from 'lucide-react'
import { useWebSearchStatus } from '@/lib/hooks/use-web-discovery'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Button } from '@/components/ui/button'

export function WebSearchSettings() {
  const { t } = useTranslation()
  const status = useWebSearchStatus()
  const ready = status.data?.state === 'ready' && !status.isError && !status.isFetching
  const trial = ready && status.data?.access_mode === 'keyless_trial'
  const needsConfiguration = status.data?.state === 'configuration_required' && !status.isError && !status.isFetching
  return <section id="web-search" className="scroll-mt-4 space-y-3 rounded-lg border bg-card p-5" aria-labelledby="web-discovery-settings-title">
    <h2 id="web-discovery-settings-title" className="flex items-center gap-2 text-base font-semibold"><Globe2 className="size-4 text-muted-foreground" aria-hidden="true" />{t('learningWorkspace.webSearchSettings')}</h2>
    <p className="text-sm leading-6" role={status.isError ? 'alert' : 'status'}>{t(status.isError ? 'webDiscovery.statusUnavailable' : status.isFetching ? 'common.loading' : ready ? 'learningWorkspace.webSearchReady' : 'webDiscovery.configurationRequired')}</p>
    {trial && <div className="space-y-1"><p className="text-sm font-medium">{t('webDiscovery.trialMode')}</p><p className="text-xs leading-5 text-muted-foreground">{t('webDiscovery.trialQuota')}</p></div>}
    {needsConfiguration && <p className="text-sm leading-6 text-muted-foreground">{t('webDiscovery.configurationHelp')}</p>}
    <p className="text-xs leading-5 text-muted-foreground">{t(trial ? 'webDiscovery.trialPrivacy' : 'webDiscovery.privacyNotice')}</p>
    <Button size="sm" variant="outline" disabled={status.isFetching} onClick={() => void status.refetch()}>{t('webDiscovery.retryStatus')}</Button>
  </section>
}
