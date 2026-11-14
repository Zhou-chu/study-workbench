'use client'
import { useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notebooklmApi } from '@/lib/api/notebooklm'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useNotebookLMCapabilities, useNotebookLMFlow, useNotebookLMStatus, useRemoteNotebooks, useRemoteSources, useRemoteArtifacts } from '@/lib/hooks/use-notebooklm'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { RemoteLink } from '@/lib/types/personal'
import { connectionKeys, requestError } from '@/lib/utils/workbench'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Props {
  notebookId: string
  selectedVersionIds: string[]
  remoteSourceIds: string[]
  scopeSupported?: boolean
  selectionOrigin?: 'local' | 'remote'
  link: RemoteLink | null
  onRemoteSelection: (ids: string[]) => void
  onChanged: () => void
}
interface Confirmation { scopeSensitive?: boolean; description: string; target?: string; versions?: string[]; remoteSources?: string[]; language?: string; run: () => Promise<unknown> }
export function NotebookLMPanel({ notebookId, selectedVersionIds, remoteSourceIds, scopeSupported = true, selectionOrigin = 'local', link, onRemoteSelection, onChanged }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const supportedScope = useRef(scopeSupported)
  useLayoutEffect(() => {
    supportedScope.current = scopeSupported
    // An admitted mutation can outlive this panel (for example opaque origin).
    return () => { supportedScope.current = false }
  }, [scopeSupported])
  const runScoped = (run: () => Promise<unknown>) => {
    if (!supportedScope.current) throw new Error(t('workbench.unavailable'))
    return run()
  }
  const status = useNotebookLMStatus()
  const capabilities = useNotebookLMCapabilities()
  const [flowId, setFlowId] = useState<string>()
  const flow = useNotebookLMFlow(flowId)
  const [showNotebooks, setShowNotebooks] = useState(false)
  const [showSources, setShowSources] = useState(false)
  const [showArtifacts, setShowArtifacts] = useState(false)
  const artifacts = useRemoteArtifacts(link?.remote_notebook_id || '', showArtifacts)
  const [remoteId, setRemoteId] = useState('')
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState('zh')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const notebooks = useRemoteNotebooks(showNotebooks)
  const sources = useRemoteSources(link?.remote_notebook_id || '', showSources)
  const actualStatus = flow.data || status.data
  const connected = actualStatus?.state === 'connected'
  const action = useMutation({ mutationFn: (run: () => Promise<unknown>) => run(), retry: false,
    onSuccess: () => { onChanged(); queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebooklm }) },
    onError: () => { setFlowId(undefined); queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebooklm }) },
  })
  const available = (name: string) => capabilities.data?.operations.find(operation => operation.name === name)?.support === 'available'
  const audioBlocked = ['unsupported', 'temporarily_unavailable'].includes(capabilities.data?.operations.find(operation => operation.name === 'generate_audio')?.support || 'unsupported')
  const startLogin = () => action.mutate(async () => { const result = await notebooklmApi.connect(actualStatus?.state === 'needs_reauth'); setFlowId(result.flow_id); return result })
  const confirmScoped = (kind: 'sync' | 'import' | 'audio') => {
    if (!supportedScope.current || !link) return
    const target = link.remote_notebook_id
    const versions = [...selectedVersionIds]
    const remoteSources = [...remoteSourceIds]
    const key = crypto.randomUUID()
    const audioLanguage = language
    setConfirmation({ scopeSensitive: true, description: t({ sync: 'workbench.syncConfirm', import: 'workbench.importConfirm', audio: 'workbench.audioConfirm' }[kind]), target, versions: kind === 'import' || (kind === 'audio' && selectionOrigin === 'remote') ? [] : versions, remoteSources: kind === 'sync' || (kind === 'audio' && selectionOrigin === 'local') ? [] : remoteSources, language: kind === 'audio' ? audioLanguage : undefined,
      run: () => runScoped(() => kind === 'sync' ? notebooklmApi.sync(notebookId, { remote_notebook_id: target, source_version_ids: versions, idempotency_key: key })
        : kind === 'import' ? notebooklmApi.importSources(notebookId, { remote_notebook_id: target, remote_source_ids: remoteSources, include_text: true, idempotency_key: key })
          : notebooklmApi.audio(notebookId, { remote_notebook_id: target, source_version_ids: selectionOrigin === 'local' ? versions : [], remote_source_ids: selectionOrigin === 'remote' ? remoteSources : [], language: audioLanguage, idempotency_key: key })),
    })
  }
  const create = () => {
    const name = title.trim()
    const key = crypto.randomUUID()
    setConfirmation({ description: t('workbench.confirmCreate', { title: name }), run: () => notebooklmApi.createNotebook(notebookId, name, key) })
  }
  const options = notebooks.data?.pages.flatMap(page => page.items) || []
  const remoteSources = sources.data?.pages.flatMap(page => page.items) || []
  const audioCapability = capabilities.data?.operations.find(operation => operation.name === 'generate_audio')
  return <section className="space-y-3 border-t pt-3" aria-label={t('workbench.googleConnection')}>
    <h3 className="font-semibold">{t('workbench.googleConnection')}</h3>
    <p className="text-sm">{actualStatus ? t(connectionKeys[actualStatus.state] || 'workbench.unavailable') : t('workbench.connectionNotVerified')}</p>
    {actualStatus?.account_label && <p className="text-xs">{actualStatus.account_label}</p>}
    {actualStatus?.reason && <p className="text-xs text-muted-foreground">{actualStatus.reason}</p>}
    {actualStatus?.last_verified_at && <p className="text-xs">{t('workbench.verifiedAt', { time: actualStatus.last_verified_at })}</p>}
    {actualStatus?.quota == null && <p className="text-xs text-muted-foreground">{t('workbench.quotaUnknown')}</p>}
    {(status.isError || capabilities.isError || action.isError || notebooks.isError || sources.isError || flow.isError) && <p role="alert" className="text-sm text-destructive">{requestError(action.error) || requestError(status.error) || t('workbench.error')}</p>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={action.isPending} onClick={startLogin}>{t(actualStatus?.state === 'needs_reauth' ? 'workbench.reconnect' : 'workbench.connect')}</Button>
      <Button size="sm" variant="ghost" onClick={() => { status.refetch(); capabilities.refetch(); if (flowId) flow.refetch() }}>{t('workbench.refresh')}</Button>
      {connected && <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => setConfirmation({ description: t('workbench.disconnectConfirm'), run: async () => { const result = await notebooklmApi.disconnect(); setFlowId(undefined); return result } })}>{t('workbench.disconnect')}</Button>}
    </div>
    {flowId && <p className="text-xs text-muted-foreground">{t('workbench.loginInstructions')}</p>}
    <details className="text-xs"><summary>{t('workbench.capabilities')}</summary><ul className="space-y-2 py-2">{capabilities.data?.operations.map(operation => <li key={operation.name}>{operation.name}: {operation.support}{operation.reason && <p>{operation.reason}</p>}{operation.last_verified_at && <p>{t('workbench.verifiedAt', { time: operation.last_verified_at })}</p>}</li>)}</ul></details>
    {link && <p className="break-all text-xs">{t('workbench.linked', { id: link.remote_notebook_id })}</p>}
    <Button size="sm" variant="outline" disabled={!connected || action.isPending} onClick={() => setShowNotebooks(true)}>{t('workbench.listNotebooks')}</Button>
    {showNotebooks && <div className="space-y-2">
      <label className="text-sm" htmlFor="remote-notebook">{t('workbench.remoteNotebook')}</label>
      <select className="w-full rounded-md border bg-background p-2 text-sm" id="remote-notebook" value={remoteId} onChange={event => setRemoteId(event.target.value)}><option value="">{t('workbench.remoteNotebook')}</option>{options.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select>
      {!options.length && !notebooks.isFetching && <p className="text-xs">{t('workbench.noRemoteNotebooks')}</p>}
      {notebooks.hasNextPage && <Button size="sm" variant="ghost" onClick={() => notebooks.fetchNextPage()} disabled={notebooks.isFetching}>{t('common.next')}</Button>}
      {notebooks.data?.pages.some(page => page.listing_complete === false) && <p className="text-xs">{t('workbench.listIncomplete')}</p>}
      <Button size="sm" disabled={!remoteId || action.isPending} onClick={() => action.mutate(async () => { const result = await notebooklmApi.link(notebookId, remoteId); onRemoteSelection([]); setShowSources(false); return result })}>{t('workbench.link')}</Button>
    </div>}
    <label htmlFor="remote-new-title" className="text-xs block">{t('workbench.remoteTitle')}</label>
    <Input id="remote-new-title" value={title} onChange={event => setTitle(event.target.value)} />
    <Button size="sm" variant="outline" disabled={!connected || !title.trim() || action.isPending} onClick={create}>{t('workbench.createRemote')}</Button>
    <div className="space-y-2 border-t pt-3">
      <Button size="sm" variant="outline" disabled={!scopeSupported || !connected || !link || !selectedVersionIds.length || action.isPending} onClick={() => confirmScoped('sync')}>{t('workbench.syncSelected')}</Button>
      <Button size="sm" variant="outline" disabled={!connected || !link} onClick={() => setShowSources(true)}>{t('workbench.loadRemoteSources')}</Button>
      {showSources && <div className="space-y-2 max-h-60 overflow-y-auto">
        <p className="text-xs text-muted-foreground">{t('workbench.remoteOriginalWarning')}</p>
        {remoteSources.map(source => <label className="flex gap-2 items-start text-sm" key={source.id}><input type="checkbox" checked={remoteSourceIds.includes(source.id)} onChange={event => onRemoteSelection(event.target.checked ? [...remoteSourceIds, source.id] : remoteSourceIds.filter(id => id !== source.id))} />{source.title}</label>)}
        {!remoteSources.length && !sources.isFetching && <p className="text-xs">{t('workbench.noRemoteSources')}</p>}
        {sources.hasNextPage && <Button size="sm" variant="ghost" onClick={() => sources.fetchNextPage()} disabled={sources.isFetching}>{t('common.next')}</Button>}
        {sources.data?.pages.some(page => page.listing_complete === false) && <p className="text-xs">{t('workbench.listIncomplete')}</p>}
      </div>}
      <Button size="sm" variant="outline" disabled={!scopeSupported || !connected || !link || !remoteSourceIds.length || action.isPending} onClick={() => confirmScoped('import')}>{t('workbench.importSelected')}</Button>
    </div>
    <Button size="sm" variant="outline" disabled={!scopeSupported || !connected || !link || selectedVersionIds.length !== 1 || remoteSourceIds.length !== 1 || action.isPending} onClick={() => {
      if (!supportedScope.current || !link) return
      const target = link.remote_notebook_id
      const sourceVersionId = selectedVersionIds[0]
      const remoteSourceId = remoteSourceIds[0]
      setConfirmation({ scopeSensitive: true, description: t('workbench.associateConfirm'), target, versions: [sourceVersionId], remoteSources: [remoteSourceId], run: () => runScoped(() => notebooklmApi.associateSource(notebookId, { remote_notebook_id: target, source_version_id: sourceVersionId, remote_source_id: remoteSourceId, user_confirmed: true })) })
    }}>{t('workbench.associateSource')}</Button>
    <label className="block text-xs" htmlFor="audio-language">{t('workbench.audioLanguage')}</label>
    <Input id="audio-language" value={language} onChange={event => setLanguage(event.target.value)} />
    <Button size="sm" variant="outline" disabled={!scopeSupported || !connected || !link || audioBlocked || !(selectionOrigin === 'local' ? selectedVersionIds.length : remoteSourceIds.length) || !language || action.isPending} onClick={() => confirmScoped('audio')}>{t('workbench.audio')}</Button>
    {!available('generate_audio') && <p className="text-xs text-muted-foreground">{audioCapability?.reason || t('workbench.capabilityUnverified')}</p>}
    <Button size="sm" variant="outline" disabled={!connected || !link} onClick={() => setShowArtifacts(true)}>{t('workbench.listArtifacts')}</Button>
    {showArtifacts && <div className="space-y-2">{artifacts.isError && <p role="alert">{requestError(artifacts.error) || t('workbench.error')}</p>}{artifacts.data?.map(artifact => <div className="rounded border p-2 text-xs space-y-1" key={artifact.id}><p>{artifact.title} · {artifact.kind} · {artifact.status}</p><Button size="sm" variant="outline" disabled={artifact.status !== 'ready' || action.isPending || !link} onClick={() => action.mutate(() => notebooklmApi.downloadArtifact(artifact.id, { notebook_id: notebookId, remote_notebook_id: link!.remote_notebook_id, idempotency_key: crypto.randomUUID() }))}>{t('workbench.downloadArtifact')}</Button></div>)}</div>}
    <Dialog open={!!confirmation} onOpenChange={open => { if (!open) setConfirmation(null) }}><DialogContent data-workbench-controls><DialogHeader><DialogTitle>{t('workbench.confirmAction')}</DialogTitle><DialogDescription>{confirmation?.description}</DialogDescription></DialogHeader>
      {confirmation?.target && <p className="break-all text-sm">{t('workbench.target')}: {confirmation.target}</p>}
      {!!confirmation?.versions?.length && <div className="text-sm"><p>{t('workbench.selectedVersions')}</p><ul className="max-h-40 overflow-y-auto break-all">{confirmation.versions.map(id => <li key={id}>{id}</li>)}</ul></div>}
      {!!confirmation?.remoteSources?.length && <div className="text-sm"><p>{t('workbench.selectedRemoteSources')}</p><ul className="max-h-40 overflow-y-auto break-all">{confirmation.remoteSources.map(id => <li key={id}>{id}</li>)}</ul></div>}
      {confirmation?.language && <p>{t('workbench.audioLanguage')}: {confirmation.language}</p>}
      <DialogFooter><Button variant="outline" onClick={() => setConfirmation(null)}>{t('common.cancel')}</Button><Button disabled={action.isPending || (!!confirmation?.scopeSensitive && !scopeSupported)} onClick={() => { if (confirmation && (!confirmation.scopeSensitive || supportedScope.current)) action.mutate(confirmation.run); setConfirmation(null) }}>{t('common.confirm')}</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>
}
