'use client'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { EmbeddingDisclosure } from '@/lib/workbench/embedding-disclosure'

/** Only the frozen, nonsecret identity bound to this rendered disclosure. */
export function EmbeddingIdentity({ disclosure }: { disclosure: EmbeddingDisclosure | null }) {
  const { t } = useTranslation()
  if (!disclosure) return null
  return <div className="space-y-1 break-all">
    <p>{t('workbench.embeddingModelIdentity')}: {disclosure.provider} · {disclosure.model_name} · {disclosure.model_id}</p>
    <p>{t('workbench.embeddingRevision')}: {disclosure.revision}</p>
  </div>
}
