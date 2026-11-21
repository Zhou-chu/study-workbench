'use client'

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Globe2, Loader2, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useImportWebSource, useWebSearch, useWebSearchStatus } from '@/lib/hooks/use-web-discovery'
import { webDiscoveryErrorKey, type WebResult } from '@/lib/api/web-discovery'

interface Props {
  notebookId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported?: () => void
  onCloseAutoFocus?: (event: Event) => void
}

type ImportState = { status: 'importing' | 'imported' | 'alreadyImported' | 'importFailed'; error?: string }
const IMPORT_LABELS = {
  importing: 'webDiscovery.importing', imported: 'webDiscovery.imported',
  alreadyImported: 'webDiscovery.alreadyImported', importFailed: 'webDiscovery.importFailed',
}

export function WebDiscoveryDialog({ notebookId, open, onOpenChange, onImported, onCloseAutoFocus }: Props) {
  const { t } = useTranslation()
  const status = useWebSearchStatus(open)
  const search = useWebSearch()
  const importer = useImportWebSource()
  const trial = !status.isError && status.data?.state === 'ready' && status.data.access_mode === 'keyless_trial'
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WebResult[]>([])
  const [searched, setSearched] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [imports, setImports] = useState<Record<string, ImportState>>({})
  const [batchActive, setBatchActive] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const stopQueued = useRef(false)
  const generation = useRef(0)
  const keys = useRef<Record<string, string>>({})

  useEffect(() => () => { controller.current?.abort(); stopQueued.current = true; generation.current += 1 }, [notebookId])

  const close = (value: boolean) => {
    if (!value) {
      controller.current?.abort()
      stopQueued.current = true
      // Keep unresolved result/key pairs in this mounted dialog. Reopening can
      // reconcile the same durable receipt instead of causing a second charge.
      if (batchActive) setCancelled(true)
      search.reset()
    }
    onOpenChange(value)
  }

  const runSearch = async () => {
    if (!query.trim() || status.data?.state !== 'ready' || batchActive) return
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    const currentGeneration = ++generation.current
    setError(null)
    setSelected(new Set())
    setImports({})
    setResults([])
    setCancelled(false)
    setSearched(false)
    keys.current = {}
    try {
      const response = await search.mutateAsync({ query: query.trim(), signal: current.signal })
      if (current.signal.aborted || generation.current !== currentGeneration) return
      setResults(response.results)
      setSearched(true)
    } catch (failure) {
      if (!current.signal.aborted && generation.current === currentGeneration) setError(webDiscoveryErrorKey(failure))
    }
  }

  const importSelected = async () => {
    const queue = results.filter(result => selected.has(result.id) && (!imports[result.id] || imports[result.id].status === 'importFailed'))
    if (!queue.length || batchActive) return
    const currentGeneration = generation.current
    stopQueued.current = false
    setCancelled(false)
    setBatchActive(true)
    let next = 0
    const consume = async () => {
      while (!stopQueued.current && next < queue.length) {
        const result = queue[next++]
        keys.current[result.id] ||= crypto.randomUUID()
        setImports(value => ({ ...value, [result.id]: { status: 'importing' } }))
        try {
          // Do not abort dispatched imports: disconnect is not server rollback.
          const response = await importer.mutateAsync({ notebookId, result, idempotencyKey: keys.current[result.id] })
          onImported?.()
          if (generation.current !== currentGeneration) continue
          setImports(value => ({ ...value, [result.id]: {
            status: response.state === 'saved' ? 'importFailed' : response.state === 'already_imported' ? 'alreadyImported' : 'imported',
            error: response.state === 'saved' ? 'webDiscovery.partialNotice' : undefined,
          } }))
          if (response.state !== 'saved') setSelected(value => {
            const next = new Set(value)
            next.delete(result.id)
            return next
          })
        } catch (failure) {
          onImported?.()
          if (generation.current === currentGeneration) {
            const error = webDiscoveryErrorKey(failure)
            // Only proven configuration/quota rejections get a fresh key on
            // the next explicit click. Unknown paid outcomes retain their key.
            if (error === 'webDiscovery.errors.configuration' || error === 'webDiscovery.errors.rateLimit') delete keys.current[result.id]
            setImports(value => ({ ...value, [result.id]: { status: 'importFailed', error } }))
          }
        }
      }
    }
    await Promise.all([consume(), consume()])
    setBatchActive(false)
  }

  const cancel = () => {
    controller.current?.abort()
    stopQueued.current = true
    setCancelled(true)
  }

  return <Dialog open={open} onOpenChange={close}>
    <DialogContent data-workbench-controls className="!max-w-3xl max-h-[90dvh] flex flex-col gap-5 overflow-y-auto" aria-describedby="web-discovery-description" onCloseAutoFocus={onCloseAutoFocus}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Globe2 className="size-5 text-primary" aria-hidden />{t('webDiscovery.title')}</DialogTitle>
        <DialogDescription id="web-discovery-description">{t('webDiscovery.description')}</DialogDescription>
      </DialogHeader>
      <div className="rounded-xl border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
        {trial && <><p className="font-medium text-foreground">{t('webDiscovery.trialMode')}</p><p>{t('webDiscovery.trialQuota')}</p></>}
        <p>{t(trial ? 'webDiscovery.trialPrivacy' : 'webDiscovery.privacyNotice')}</p>
      </div>
      {status.isError ? <div role="alert" className="space-y-3"><p>{t('webDiscovery.statusUnavailable')}</p><Button variant="outline" onClick={() => void status.refetch()}>{t('webDiscovery.retryStatus')}</Button></div> : status.data?.state === 'configuration_required' ? <div className="rounded-xl border p-5 space-y-3">
        <h3 className="font-medium">{t('webDiscovery.configurationRequired')}</h3>
        <a href="/settings#web-search" target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary underline underline-offset-4">{t('webDiscovery.openSettings')}</a>
      </div> : <>
        <form className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end" onSubmit={event => { event.preventDefault(); void runSearch() }}>
          <label className="min-w-0 flex-1 space-y-2 text-sm font-medium" htmlFor="web-discovery-query">{t('webDiscovery.queryLabel')}
            <Input id="web-discovery-query" value={query} onChange={event => setQuery(event.target.value)} maxLength={500} placeholder={t('webDiscovery.queryPlaceholder')} disabled={batchActive} autoComplete="off" />
          </label>
          <Button type="submit" disabled={!query.trim() || status.data?.state !== 'ready' || search.isPending || batchActive}>
            {search.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}{t(search.isPending ? 'webDiscovery.searching' : 'webDiscovery.search')}
          </Button>
        </form>
        {error && <p role="alert" className="text-sm text-destructive">{t(error)}</p>}
        {cancelled && <p role="status" className="text-sm text-muted-foreground">{t('webDiscovery.cancelled')}</p>}
        {searched && results.length === 0 && <p className="py-12 text-center text-muted-foreground">{t('webDiscovery.empty')}</p>}
        {results.length > 0 && <>
          <div className="flex justify-between gap-4 text-xs text-muted-foreground"><span>{t('webDiscovery.resultCount', { count: results.length })}</span><span>{t('webDiscovery.selectionLimit')}</span></div>
          <div className="space-y-3 overflow-y-auto min-h-0 pr-1">
            {results.map(result => <article key={result.id} className="rounded-xl border p-4 transition-colors hover:bg-muted/30">
              <div className="flex items-start gap-3">
                <label className="flex shrink-0 cursor-pointer items-center justify-center rounded-sm">
                  <input type="checkbox" className="size-4 accent-primary" aria-label={result.title} checked={selected.has(result.id)} disabled={batchActive || (!!imports[result.id] && imports[result.id].status !== 'importFailed') || (!selected.has(result.id) && selected.size >= 5)} onChange={event => setSelected(value => { const next = new Set(value); if (event.target.checked) next.add(result.id); else next.delete(result.id); return next })} />
                </label>
                <div className="min-w-0 flex-1 space-y-2">
                  <h3 className="font-medium leading-snug">{result.title}</h3>
                  <a href={result.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary break-all"><span>{result.url}</span><ExternalLink className="size-3 shrink-0" aria-hidden /></a>
                  <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">{result.snippet}</p>
                  {imports[result.id] && <p role="status" className="text-xs font-medium">{t(IMPORT_LABELS[imports[result.id].status])}{imports[result.id].error && <> · {t(imports[result.id].error!)}</>}</p>}
                </div>
              </div>
            </article>)}
          </div>
          <p className="text-xs text-muted-foreground">{t('webDiscovery.unverifiedNotice')}</p>
        </>}
      </>}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        {(search.isPending || batchActive) && <Button variant="outline" onClick={cancel}>{t('webDiscovery.cancel')}</Button>}
        <Button variant="ghost" onClick={() => close(false)}>{t('webDiscovery.close')}</Button>
        {results.length > 0 && <Button onClick={() => void importSelected()} disabled={batchActive || !results.some(result => selected.has(result.id) && (!imports[result.id] || imports[result.id].status === 'importFailed'))}>
          {batchActive && <Loader2 className="size-4 animate-spin" aria-hidden />}{t(batchActive ? 'webDiscovery.importing' : 'webDiscovery.importSelected', { count: [...selected].filter(id => !imports[id] || imports[id].status === 'importFailed').length })}
        </Button>}
      </div>
    </DialogContent>
  </Dialog>
}
