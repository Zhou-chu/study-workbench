'use client'
import { EmbeddingIdentity } from './EmbeddingIdentity'
import { useTranslation } from '@/lib/hooks/use-translation'
import { embeddingDestinationKeys } from '@/lib/utils/workbench'
import { matchesEmbeddingDisclosure, type DisclosureIdentity } from '@/lib/workbench/embedding-disclosure'

/** This summary is always original, never inferred from the current controls. */
export function OriginalEmbeddingDisclosure({ mode, summary, identity, sourceVersionIds }: {
  mode: 'lexical' | 'hybrid' | 'documents'; summary?: unknown; identity: DisclosureIdentity; sourceVersionIds: readonly string[]
}) {
  const { t } = useTranslation()
  const safe = matchesEmbeddingDisclosure(summary, identity) ? summary : null
  return <section aria-label={t('workbench.originalEmbeddingDisclosure')} className="space-y-1 border-l-2 pl-3 text-xs text-muted-foreground">
    <h4 className="font-medium">{t('workbench.originalEmbeddingDisclosure')}</h4>
    <p>{t('workbench.originalProcessingMode', { mode: t(mode === 'documents' ? 'workbench.semanticIndex' : mode === 'hybrid' ? 'workbench.hybridMode' : 'workbench.lexicalOnly') })}</p>
    <p className="break-all">{sourceVersionIds.join(', ')}</p>
    {mode !== 'lexical' && (safe ? <>
      <p className="break-all">{safe.profile_id}</p><EmbeddingIdentity disclosure={safe} />
      <p>{t(embeddingDestinationKeys[safe.destination_kind])}</p><p className="break-all">{safe.endpoint}</p>
      <p>{t('workbench.originalDescriptorVersion', { version: safe.destination_descriptor_version })}</p>
      <p className="break-all">{safe.profile_fingerprint}</p>
    </> : <p role="status">{t('workbench.originalDisclosureUnavailable')}</p>)}
  </section>
}
