'use client'

import { useEffect, useRef, useState } from 'react'
import { evidenceApi } from '@/lib/api/evidence'
import { saveBlob } from '@/lib/api/portable'
import type { EvidenceCitation, ReadingPosition, VersionDetail } from '@/lib/types/personal'
import { canonicalCitationLocator, verifiedQuoteRange } from '@/lib/utils/evidence'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SourceProvenance } from './SourceProvenance'
import { EvidenceMaintenance } from './EvidenceMaintenance'
import { PdfCanvas, PdfTextFallback } from './PdfCanvas'
import type { PdfZoom } from './pdf-render-sizing'

interface Props {
  sourceVersionId?: string
  evidenceId?: string
  citation?: EvidenceCitation | null
  initialPage?: number
  onChanged?: () => void
  onPositionChange: (position: ReadingPosition) => void
}
export function EvidenceReader({ sourceVersionId, evidenceId: savedEvidenceId, citation, initialPage = 0, onPositionChange, onChanged }: Props) {
  const { t } = useTranslation()
  const loadedSelection = useRef('')
  const [revision, setRevision] = useState(0)
  const [detail, setDetail] = useState<VersionDetail | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [pdfZoom, setPdfZoom] = useState<{ versionId: string | undefined; zoom: PdfZoom }>({ versionId: sourceVersionId, zoom: 'fit' })
  const zoom = pdfZoom.versionId === sourceVersionId ? pdfZoom.zoom : 'fit'
  const [page, setPage] = useState(initialPage)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<'load' | 'pdf' | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloadError, setDownloadError] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const isLocalCitation = citation?.kind !== 'remote_unmapped' && citation?.source_version_id === sourceVersionId
  // Archived verification is historical. Matching immutable evidence lets us
  // locate its quote without promoting the citation's verification label.
  const canonicalEvidence = isLocalCitation ? detail?.evidence.find(record =>
    record.evidence_id === citation?.evidence_id && record.source_version_id === sourceVersionId &&
    (!detail.extraction?.extraction_id || record.extraction_id === detail.extraction.extraction_id)
  ) : undefined
  const canonicalLocator = citation && canonicalEvidence ? canonicalCitationLocator(citation, canonicalEvidence) : null
  // Fresh evidence validates quote/location, never the frozen turn's source scope.
  // Only restored unverified local references may gain a current reader badge.
  const canRefreshValidity = isLocalCitation && citation?.reference_validity === 'unverified' &&
    detail?.extraction?.verification_origin === 'restored_archive' && canonicalLocator
  const currentValidity = canRefreshValidity && canonicalEvidence?.reference_validity
    ? canonicalEvidence.reference_validity : citation?.reference_validity
  const locator = isLocalCitation ? canonicalLocator ?? (citation?.reference_validity === 'verified' ? citation.locator : undefined) : undefined
  const evidenceId = citation?.source_version_id === sourceVersionId ? citation?.evidence_id || savedEvidenceId : savedEvidenceId
  const citedPage = locator?.page_index
  // Labels such as c1 are answer-local. Compare the original reference's
  // content/location, not object identity or asynchronously verified location.
  // Equivalent parent rerenders and ordinary reading movement keep the filter.
  const filterCitationIdentity = citation ? JSON.stringify([
    citation.citation_id, citation.kind, citation.source_version_id, citation.evidence_id, citation.quote,
    citation.locator?.page_index, citation.locator?.page_label, citation.locator?.block_id,
    citation.locator?.start_offset, citation.locator?.end_offset, citation.locator?.bbox,
  ]) : null

  useEffect(() => {
    setPdfZoom(previous => previous.versionId === sourceVersionId ? previous : { versionId: sourceVersionId, zoom: 'fit' })
  }, [sourceVersionId])
  useEffect(() => { setSearch('') }, [sourceVersionId, evidenceId, filterCitationIdentity])
  useEffect(() => { setPage(initialPage) }, [sourceVersionId, initialPage])
  useEffect(() => { if (citedPage != null) setPage(citedPage) }, [sourceVersionId, citation?.citation_id, citedPage])
  useEffect(() => {
    if (!sourceVersionId) {
      loadedSelection.current = ''
      setDetail(null)
      setPdfBlob(null)
      setError(null)
      setLoading(false)
      setDownloadError(false)
      setDownloading(false)
      return
    }
    const controller = new AbortController()
    const identity = `${sourceVersionId}:${evidenceId || ''}`
    if (loadedSelection.current !== identity) {
      setDetail(null)
      setPdfBlob(null)
      setError(null)
      setDownloadError(false)
      setDownloading(false)
      loadedSelection.current = identity
    }
    setLoading(true)
    let stage: 'load' | 'pdf' = 'load'
    evidenceApi.version(sourceVersionId, controller.signal, evidenceId).then(async result => {
      if (controller.signal.aborted) return
      setDetail(result)
      if (result.version.mime_type === 'application/pdf' && result.version.original_status === 'available') {
        stage = 'pdf'
        const blob = await evidenceApi.download(sourceVersionId, controller.signal)
        if (controller.signal.aborted) return
        setPdfBlob(blob)
      }
      setError(null)
    }).catch(() => { if (!controller.signal.aborted) setError(stage) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [sourceVersionId, evidenceId, revision])

  const changePage = (value: number) => {
    if (!sourceVersionId || !Number.isFinite(value)) return
    const pageIndex = Math.max(0, Math.min(value - 1, (detail?.extraction?.page_count ?? 1) - 1))
    setPage(pageIndex)
    onPositionChange({ source_version_id: sourceVersionId, page_index: pageIndex, ...(evidenceId ? { evidence_id: evidenceId } : {}) })
  }
  const download = async () => {
    if (!sourceVersionId) return
    const identity = loadedSelection.current
    setDownloading(true)
    setDownloadError(false)
    try { saveBlob(await evidenceApi.download(sourceVersionId), detail?.version.source_title || detail?.version.title || sourceVersionId) }
    catch { if (loadedSelection.current === identity) setDownloadError(true) }
    finally { if (loadedSelection.current === identity) setDownloading(false) }
  }
  const blocks = detail?.extraction?.blocks ?? (detail?.extraction?.text ? [{ block_id: 'document', page_index: null, text: detail.extraction.text }] : [])
  const matchingBlocks = blocks.filter(block => !search || block.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const quoteBlock = blocks.find(block => block.block_id === locator?.block_id)
  const range = citation && quoteBlock && locator?.start_offset != null && locator.end_offset != null
    ? verifiedQuoteRange(quoteBlock.text, locator.start_offset, locator.end_offset, citation.quote) : null

  const webSnapshot = detail?.version.origin === 'web_snapshot' && detail.version.mime_type === 'text/markdown'
  const derivedSnapshot = detail?.version.origin === 'derived_snapshot' || detail?.version.provenance?.kind === 'derived'
  const canMaintain = detail?.version.original_status === 'available' || webSnapshot
  return <section className="space-y-3" aria-label={t('workbench.reader')}>
    {citation && <div className="workbench-reader-citation border-l-2 border-teal pl-4 py-1 space-y-2">
      <p className="font-medium">{citation.source_title}</p>
      <p className="text-xs text-muted-foreground">{t('workbench.validity', { status: t(currentValidity === 'verified' ? 'workbench.referenceVerified' : currentValidity === 'out_of_scope' ? 'workbench.referenceOutOfScope' : currentValidity === 'invalid' ? 'workbench.referenceInvalid' : 'workbench.referenceUnverified') })}</p>
      <p className="text-xs text-muted-foreground">{t('workbench.verificationMeaning')}</p>
      <p className="text-xs font-medium">{t('workbench.quote')}</p>
      <p className="whitespace-pre-wrap text-sm leading-7">{citation.quote}</p>
      {citation.provenance && <SourceProvenance provenance={citation.provenance} /> }
      {citation.kind === 'derived_snapshot' && !citation.provenance && <p className="text-xs text-muted-foreground">{t('sourceSnapshots.notIndependentEvidence')}</p>}
      {citation.kind === 'remote_unmapped' && <p className="text-sm text-muted-foreground">{t('workbench.remoteUnmapped')}</p>}
      {citation.locator?.page_label && <p>{t('workbench.printPage', { label: citation.locator.page_label })}</p>}
    </div>}
    {!sourceVersionId && !citation && <p className="text-muted-foreground">{t('workbench.chooseSource')}</p>}
    {error && <div className="space-y-2"><p role="alert" className="text-destructive">{t(error === 'load' ? 'workbench.readerLoadFailed' : 'workbench.readerPdfFailed')}</p><Button size="sm" variant="outline" disabled={loading} onClick={() => { if (!loading) { setLoading(true); setRevision(value => value + 1) } }}>{t('workbench.retry')}</Button></div>}
    {downloadError && <p role="alert" className="text-destructive">{t('workbench.readerDownloadFailed')}</p>}
    {sourceVersionId && !detail && !error && <p role="status">{t('common.loading')}</p>}
    {detail && <>
      {detail.version.provenance && !citation?.provenance && <SourceProvenance provenance={detail.version.provenance} />}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0"><p className="text-sm font-medium truncate">{detail.version.source_title || detail.version.title}</p></div>
        {detail.version.original_status === 'available' ? <Button size="sm" variant="outline" onClick={download} disabled={downloading}>{t(derivedSnapshot ? 'common.download' : 'workbench.downloadOriginal')}</Button> : <p className="text-sm text-muted-foreground">{t('workbench.originalMissing')}</p>}
      </div>
      <details key={`${sourceVersionId}:${evidenceId || ''}`} open={canMaintain && detail.extraction?.verification_origin === 'restored_archive'} className="border-b pb-3 text-xs">
        <summary className="cursor-pointer py-1 text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring rounded-sm">{t('workbench.documentTools')}</summary>
        <p className="break-all py-2 text-muted-foreground">{detail.version.source_version_id}</p>
        {canMaintain && <EvidenceMaintenance key={`${sourceVersionId}:${evidenceId || ''}`} versionId={detail.version.source_version_id} extractionId={detail.extraction?.extraction_id} snapshot={webSnapshot} restored={detail.extraction?.verification_origin === 'restored_archive'} onComplete={() => { setRevision(value => value + 1); onChanged?.() }} />}
      </details>
      {detail.extraction?.warnings?.map((warning, index) => <p className="text-sm text-muted-foreground" key={index}>{warning}</p>)}
      {detail.version.mime_type === 'application/pdf' && <>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="physical-page">{t('workbench.pdfPage')}</label>
          <Input id="physical-page" className="w-20" type="number" min={1} max={detail.extraction?.page_count || 1} value={page + 1} onChange={event => changePage(Number(event.target.value))} />
          <span className="text-xs">{t('workbench.pageOf', { page: page + 1, count: detail.extraction?.page_count ?? undefined })}</span>
        </div>
        <p className="text-xs text-muted-foreground">{t('workbench.highlightUnavailable')}</p>
        {pdfBlob ? <PdfCanvas blob={pdfBlob} pageIndex={page} zoom={zoom} onZoomChange={value => setPdfZoom({ versionId: sourceVersionId, zoom: value })} fallbackText={blocks.filter(block => block.page_index === page).map(block => block.text).join('\n\n')} /> : error || detail.version.original_status !== 'available' ? <PdfTextFallback text={blocks.filter(block => block.page_index === page).map(block => block.text).join('\n\n')} /> : <p role="status" className="text-sm text-muted-foreground">{t('workbench.pdfRendering')}</p>}
      </>}
      <div className="space-y-2">
        <label className="block text-sm" htmlFor="evidence-search">{t('workbench.searchEvidence')}</label>
        <div className="flex items-center gap-2"><Input id="evidence-search" value={search} onChange={event => setSearch(event.target.value)} />{search && <Button size="sm" variant="outline" onClick={() => setSearch('')}>{t('workbench.clearReaderSearch')}</Button>}</div>
      </div>
      {citation && !range && detail.version.mime_type !== 'application/pdf' && <p className="text-xs text-muted-foreground">{t('workbench.quoteMismatch')}</p>}
      <div className="max-h-[55vh] overflow-y-auto space-y-3">
        {matchingBlocks.length ? matchingBlocks.map(block => <div key={block.block_id} className="rounded-md border p-3">
          {block.page_index != null && <Button size="sm" variant="ghost" onClick={() => changePage(block.page_index! + 1)}>{t('workbench.pageOf', { page: block.page_index + 1, count: detail.extraction?.page_count ?? undefined })}</Button>}
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7">{range && block === quoteBlock ? <>{range.before}<mark className="bg-warn-tint text-foreground">{range.quote}</mark>{range.after}</> : block.text}</pre>
        </div>) : <p role="status" className="text-sm text-muted-foreground">{t(blocks.length ? 'workbench.readerNoMatches' : 'workbench.noEvidence')}</p>}
      </div>
    </>}
  </section>
}
