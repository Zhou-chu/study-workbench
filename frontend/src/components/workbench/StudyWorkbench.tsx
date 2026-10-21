'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, BookOpen, Files, MessageSquare, NotebookPen, Search, Upload, CircleCheck, Layers } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { evidenceApi } from '@/lib/api/evidence'
import { useModelDefaults } from '@/lib/hooks/use-models'
import { useNotebookLMStatus, useNotebookLMCapabilities } from '@/lib/hooks/use-notebooklm'
import { useWorkbenchUploads } from '@/lib/hooks/use-workbench-uploads'
import { workbenchApi } from '@/lib/api/workbench'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { activeJob, useSaveWorkbenchSelection, useWorkbench } from '@/lib/hooks/use-workbench'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useToast } from '@/lib/hooks/use-toast'
import { canonicalCitationLocator } from '@/lib/utils/evidence'
import { requestError, stateKeys, connectionKeys } from '@/lib/utils/workbench'
import type { BridgeJob, EvidenceCitation, ScopeSnapshot, TurnRecord, WorkbenchNote, WorkbenchSelection } from '@/lib/types/personal'
import { EvidenceReader } from '@/components/evidence/EvidenceReader'
import { NotebookLMPanel } from '@/components/integrations/NotebookLMPanel'
import { JobsPanel } from './JobsPanel'
import { PortableControls } from './PortableControls'
import { TurnCoverage } from './TurnCoverage'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const workspaceTabs = ['sources', 'conversation', 'notes'] as const
const panelLabels = { sources: 'workbench.sources', conversation: 'workbench.readingAndQuestions', notes: 'workbench.notes' }
const panelIcons = { sources: Files, conversation: MessageSquare, notes: NotebookPen }
const emptySelection: WorkbenchSelection = { engine: 'notebooklm', selection_origin: 'local', source_version_ids: [], remote_source_ids: [] }
interface NoteEditorSnapshot { session: number; revision: number }
export function StudyWorkbench({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const workspace = useWorkbench(notebookId)
  const connection = useNotebookLMStatus()
  const capabilities = useNotebookLMCapabilities()
  const modelDefaults = useModelDefaults()
  const [searchText, setSearchText] = useState('')
  const data = workspace.data
  const saveSelection = useSaveWorkbenchSelection(notebookId)
  const [draft, setDraft] = useState<WorkbenchSelection | null>(null)
  const selection = useMemo(() => draft || { ...emptySelection, ...data?.selection }, [draft, data?.selection])
  const selectionRef = useRef(selection)
  const citationRequest = useRef(0)
  useEffect(() => { selectionRef.current = selection }, [selection])
  const [tab, setTab] = useState('conversation')
  const uploadInput = useRef<HTMLInputElement>(null)
  const [focusUpload, setFocusUpload] = useState(false)
  const googleDisclosure = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (focusUpload && tab === 'sources') { uploadInput.current?.focus(); setFocusUpload(false) }
  }, [focusUpload, tab])
  useEffect(() => {
    if (selection.selection_origin === 'remote' && googleDisclosure.current) googleDisclosure.current.open = true
  }, [selection.selection_origin])
  const [readerOpen, setReaderOpen] = useState(true)
  const [citation, setCitation] = useState<EvidenceCitation | null>(null)
  const [question, setQuestion] = useState('')
  // A save may finish after New, Edit, or an outline replaced the draft.
  const noteEditorSession = useRef(0)
  const noteEditorRevision = useRef(0)
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [editingNote, setEditingNote] = useState<WorkbenchNote | null>(null)
  const [noteScope, setNoteScope] = useState<ScopeSnapshot | undefined>()
  const [pendingJob, setPendingJob] = useState<string | null>(null)
  const [lastJobOutcome, setLastJobOutcome] = useState<BridgeJob | null>(null)
  const [pendingTurn, setPendingTurn] = useState<string | null>(null)
  const [outlineTurn, setOutlineTurn] = useState<({ turnId: string } & NoteEditorSnapshot) | null>(null)
  const sessionId = `v1_${notebookId}`
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workbench(notebookId) })
  const { uploads, upload, retryUpload, dismissUpload } = useWorkbenchUploads(notebookId, refresh)
  const history = useQuery({ queryKey: QUERY_KEYS.personalTurns(sessionId), queryFn: () => workbenchApi.turns(sessionId), enabled: !!pendingTurn, retry: false, refetchInterval: pendingTurn ? 2000 : false })
  const pendingStatus = useQuery({ queryKey: QUERY_KEYS.personalJob(pendingJob || ''), queryFn: ({ signal }) => workbenchApi.job(pendingJob!, signal), enabled: !!pendingJob, retry: false, refetchInterval: query => activeJob(query.state.data?.state) ? 2000 : false })
  const turns = [...new Map([...(data?.turns || []), ...(history.data || [])].map(turn => [turn.turn_id, turn])).values()]
  const selectedCount = selection.selection_origin === 'local' ? selection.source_version_ids.length : selection.remote_source_ids.length
  // Configuration availability is not an inference or credential health check.
  // A failed refresh must not authorize a turn using stale cached defaults.
  const modelState = modelDefaults.isFetching || modelDefaults.isLoading ? 'loading' :
    modelDefaults.isError ? 'error' : !modelDefaults.data ? 'loading' :
    !modelDefaults.data.default_chat_model ? 'notConfigured' : 'ready'
  const modelStatusKey = { loading: 'workbench.modelChecking', error: 'workbench.modelCheckFailed', notConfigured: 'workbench.notConfigured', ready: 'workbench.modelConfigured' }[modelState]
  const modelBlocked = selection.engine === 'independent' && modelState !== 'ready'
  const connectionStatusKey = connection.isError ? 'workbench.googleCheckFailed' :
    connection.isFetching || connection.isLoading || !connection.data ? 'workbench.googleChecking' :
    connectionKeys[connection.data.state] || 'workbench.googleChecking'
  const askCapability = capabilities.data?.operations.find(operation => operation.name === 'ask')
  const googleBlocked = selection.engine === 'notebooklm' ? (
    connection.isError || capabilities.isError ? t('workbench.googleCheckFailed') :
    connection.isLoading || capabilities.isLoading || !connection.data || !capabilities.data ? t('workbench.googleChecking') :
    connection.data.state !== 'connected' ? t('workbench.connectionNotVerified') :
    askCapability?.support !== 'available' ? askCapability?.reason || t('workbench.googleAskUnavailable') :
    !data?.link?.remote_notebook_id ? t('workbench.googleLinkRequired') : null
  ) : null
  const canAsk = selectedCount > 0 && !modelBlocked && !googleBlocked && !(selection.engine === 'independent' && selection.selection_origin === 'remote')
  const updateSelection = (patch: Partial<WorkbenchSelection>) => {
    const next = { ...selectionRef.current, ...patch }
    selectionRef.current = next
    setDraft(next)
    saveSelection.mutate(next)
  }
  const search = useMutation({ mutationFn: () => evidenceApi.search(searchText, [...selection.source_version_ids]), retry: false })
  const ask = useMutation({
    mutationFn: ({ message, outline }: { message: string; outline?: boolean; editorSnapshot?: NoteEditorSnapshot }) => workbenchApi.turn(sessionId, {
      task: outline ? 'outline' : 'question', notebook_id: notebookId, engine: selection.engine, selection_origin: selection.selection_origin,
      source_version_ids: selection.selection_origin === 'local' ? [...selection.source_version_ids] : [],
      remote_source_ids: selection.selection_origin === 'remote' ? [...selection.remote_source_ids] : [],
      remote_notebook_id: data?.link?.remote_notebook_id || null, message, idempotency_key: crypto.randomUUID(),
    }), retry: false,
    onSuccess: (turn, variables) => { setQuestion(''); setLastJobOutcome(null); setPendingJob('job_id' in turn ? turn.job_id : null); setPendingTurn(turn.turn_id); if (variables.outline && variables.editorSnapshot) setOutlineTurn({ turnId: turn.turn_id, ...variables.editorSnapshot }); refresh() },
  })
  useEffect(() => {
    const result = history.data?.find(turn => turn.turn_id === pendingTurn)
    if (result && (!activeJob(result.state || result.status) || result.answer)) { setPendingTurn(null); setPendingJob(null) }
    const outline = history.data?.find(turn => turn.turn_id === outlineTurn?.turnId)
    if (outline?.answer && outlineTurn) {
      // Keep late outlines in history (including Save Answer) instead of replacing
      // a draft the user changed after submitting the outline request.
      if (outlineTurn.session === noteEditorSession.current && outlineTurn.revision === noteEditorRevision.current) {
        noteEditorSession.current++
        setNoteTitle(t('workbench.outline')); setNoteContent(outline.answer); setNoteScope(outline.scope_snapshot)
        setEditingNote({ id: '', title: '', content: '', citations: outline.citations, scope_snapshot: outline.scope_snapshot })
        setTab('notes')
      }
      setOutlineTurn(null)
    }
  }, [history.data, pendingTurn, outlineTurn, t])
  useEffect(() => {
    const job = pendingStatus.data
    if (!pendingJob || !job || job.job_id !== pendingJob || activeJob(job.state) || job.state === 'succeeded') return
    setLastJobOutcome(job)
    setPendingTurn(null)
    setPendingJob(null)
    setOutlineTurn(null)
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workbench(notebookId) })
  }, [pendingStatus.data, pendingJob, queryClient, notebookId])
  const note = useMutation({
    mutationFn: (value: Omit<WorkbenchNote, 'id'> & { noteId?: string; editorSession?: number }) => {
      const payload = { title: value.title, content: value.content, citations: value.citations, scope_snapshot: value.scope_snapshot }
      return value.noteId ? workbenchApi.updateNote(notebookId, value.noteId, payload) : workbenchApi.saveNote(notebookId, payload)
    }, retry: false,
    onSuccess: (saved, value) => { refresh(); if (value.editorSession !== undefined && value.editorSession === noteEditorSession.current) setEditingNote(saved); toast({ title: t('workbench.saved') }) },
    onError: error => toast({ title: requestError(error) || t('workbench.error'), variant: 'destructive' }),
  })
  const openCitation = async (reference: EvidenceCitation) => {
    const request = ++citationRequest.current
    setCitation(reference); setReaderOpen(true); setTab('conversation')
    if (reference.kind === 'remote_unmapped' || !reference.source_version_id) return
    updateSelection({ reading: { source_version_id: reference.source_version_id, page_index: reference.reference_validity === 'verified' ? reference.locator?.page_index ?? 0 : 0, evidence_id: reference.evidence_id || undefined } })
    // Restored citations keep their archived verification label. Re-read the
    // immutable evidence before using its location; never infer a page by title.
    if (reference.reference_validity !== 'verified' && reference.evidence_id) {
      try {
        const evidence = await evidenceApi.evidence(reference.evidence_id)
        const locator = canonicalCitationLocator(reference, evidence)
        if (request === citationRequest.current && locator) {
          updateSelection({ reading: { source_version_id: evidence.source_version_id, page_index: locator.page_index ?? 0, evidence_id: evidence.evidence_id } })
        }
      } catch { toast({ title: t('workbench.quoteMismatch'), variant: 'destructive' }) }
    }
  }
  const saveAnswer = (turn: TurnRecord) => note.mutate({ title: turn.message, content: turn.answer || '', citations: turn.citations || [], scope_snapshot: turn.scope_snapshot })
  if (workspace.isLoading) return <p className="p-6" role="status">{t('common.loading')}</p>
  if (!data) return <div className="p-6 space-y-3"><p role="alert">{requestError(workspace.error) || t('workbench.serviceError')}</p><Button onClick={() => workspace.refetch()}>{t('workbench.retry')}</Button></div>
  const readVersion = citation?.kind === 'remote_unmapped' ? undefined : selection.reading?.source_version_id
  const hasRemoteContext = Boolean(data.link?.remote_notebook_id) || (selection.selection_origin === 'remote' && selection.remote_source_ids.length > 0)
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
    <header className="shrink-0 border-b bg-card px-4 pt-4 pb-3 lg:px-6 space-y-3">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="min-w-0 flex-1">
          <Link className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring rounded-sm" href={`/notebooks/${encodeURIComponent(notebookId)}`}><ArrowLeft className="size-3" aria-hidden="true" />{t('workbench.back')}</Link>
          <h1 className="font-display text-2xl font-medium tracking-tight break-words mt-1">{data.notebook.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{t('workbench.title')}</span><span className="inline-flex items-center gap-1"><CircleCheck className="size-3 text-fern" aria-hidden="true" />{t('workbench.serviceOnline')}</span></p>
        </div>
        <PortableControls notebookId={notebookId} onChanged={refresh} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm border-t pt-3">
        <div className="flex items-center gap-2"><label htmlFor="workbench-engine" className="text-xs text-muted-foreground">{t('workbench.engine')}</label>
          <select id="workbench-engine" className="min-w-0 max-w-full rounded-md border bg-background px-2 py-1.5 text-xs focus-visible:ring-2 focus-visible:ring-ring" value={selection.engine} onChange={event => updateSelection({ engine: event.target.value as WorkbenchSelection['engine'] })}><option value="notebooklm">{t('workbench.notebooklm')}</option><option value="independent">{t('workbench.independent')}</option></select>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary"><Layers className="size-3.5" aria-hidden="true" />{t('workbench.selectedCount', { count: selectedCount })}</span>
        {selection.engine === 'notebooklm' && <span className="text-xs text-muted-foreground">{t(connectionStatusKey)}</span>}<Link href="/settings/models" className="text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring rounded-sm lg:ml-auto">{t('workbench.modelSettings')}</Link>
      </div>
      <div role="tablist" aria-label={t('workbench.title')} className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1 xl:hidden">{workspaceTabs.map(name => {
        const Icon = panelIcons[name]
        return <Button key={name} id={`workbench-tab-${name}`} role="tab" aria-controls={`workbench-panel-${name}`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} variant={tab === name ? 'default' : 'ghost'} size="sm" className="min-w-0 gap-1 text-xs" onClick={() => setTab(name)} onKeyDown={event => {
          const index = workspaceTabs.indexOf(name)
          const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1
          if (next < 0) return
          event.preventDefault()
          setTab(workspaceTabs[next])
          document.getElementById(`workbench-tab-${workspaceTabs[next]}`)?.focus()
        }}><Icon className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{t(panelLabels[name])}</span></Button>
      })}</div>
    </header>
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside id="workbench-panel-sources" aria-label={t('workbench.sources')} className={cn('min-h-0 overflow-auto border-r bg-card px-4 pb-5 space-y-4 w-full xl:block xl:w-72 xl:min-w-56 xl:max-w-[32vw] xl:shrink-0 xl:resize-x', tab !== 'sources' && 'hidden')}>
        <h2 className="sticky top-0 z-10 flex items-center gap-2 border-b bg-card py-4 text-sm font-semibold"><Files className="size-4 text-muted-foreground" aria-hidden="true" />{t('workbench.sources')}<span className="ml-auto font-normal text-muted-foreground tabular-nums">{data.sources.length}</span></h2>
        <label className="relative flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-primary/40 bg-fern-tint px-3 py-4 text-sm font-medium text-primary focus-within:ring-2 focus-within:ring-ring"><Upload className="size-4" aria-hidden="true" /><span>{t('workbench.upload')}</span><input ref={uploadInput} className="sr-only" type="file" accept=".pdf,.md,.markdown,.txt" multiple onChange={event => { void upload(event.target.files); event.target.value = '' }} /></label>
        {uploads.map(item => <div key={item.id} className="space-y-1 text-xs"><p className="break-all" role="status">{item.name}: {t({ uploading: 'workbench.uploading', uploadAccepted: 'workbench.uploadAccepted', uploadFailed: 'workbench.uploadFailed', uploadUncertain: 'workbench.uploadUncertain' }[item.state])}{item.error && ` · ${item.error}`}</p>{item.state !== 'uploading' && <div className="flex flex-wrap gap-2">{item.state !== 'uploadAccepted' && <Button size="sm" variant="outline" onClick={() => { void retryUpload(item.id) }}>{t('workbench.retryUpload')}</Button>}<Button size="sm" variant="ghost" onClick={() => dismissUpload(item.id)}>{t('workbench.dismissUpload')}</Button></div>}{item.state === 'uploadUncertain' && <p className="text-muted-foreground">{t('workbench.uploadRecoveryHint')}</p>}</div>)}
        <label htmlFor="workbench-scope" className="block text-xs">{t('workbench.scope')}</label><select id="workbench-scope" className="w-full rounded-md border bg-background p-2 text-sm" value={selection.selection_origin} onChange={event => updateSelection({ selection_origin: event.target.value as 'local' | 'remote' })}><option value="local">{t('workbench.localScope')}</option><option value="remote">{t('workbench.remoteScope')}</option></select>
        {selection.selection_origin === 'remote' && <p className="text-xs text-muted-foreground">{t('workbench.remoteOriginalWarning')}</p>}
        <p className="text-xs text-muted-foreground">{t('workbench.readingScopeHint')}</p>
        <div className="flex flex-wrap gap-1"><Button size="sm" variant="ghost" onClick={() => updateSelection({ source_version_ids: data.sources.flatMap(source => source.versions.length ? [[...source.versions].sort((a, b) => b.created_at.localeCompare(a.created_at))[0].source_version_id] : []), selection_origin: 'local' })}>{t('workbench.selectAll')}</Button><Button size="sm" variant="ghost" onClick={() => updateSelection({ source_version_ids: [], remote_source_ids: [] })}>{t('workbench.clearSelection')}</Button></div>
        <label htmlFor="workspace-search" className="text-xs flex items-center gap-1.5"><Search className="size-3.5" aria-hidden="true" />{t('workbench.searchEvidence')}</label><Input id="workspace-search" value={searchText} onChange={event => setSearchText(event.target.value)} /><Button size="sm" variant="outline" disabled={!searchText.trim() || !selection.source_version_ids.length || search.isPending} onClick={() => search.mutate()}>{t('workbench.search')}</Button>
        {search.isError && <p role="alert" className="text-xs text-destructive">{requestError(search.error) || t('workbench.error')}</p>}
        {search.data?.hits.map(hit => <button key={hit.evidence_id} className="w-full rounded border p-2 text-left text-xs hover:bg-muted" onClick={() => openCitation({ citation_id: hit.evidence_id, evidence_id: hit.evidence_id, source_version_id: hit.source_version_id, source_title: hit.source_title || hit.source_version_id, kind: hit.evidence_kind === 'remote_text_snapshot' ? 'remote_text_snapshot' : 'local_evidence', locator: hit.locator, quote: hit.quote, reference_validity: hit.reference_validity || 'unverified' })}>{hit.quote}</button>)}
        {!data.sources.length && <p className="text-sm text-muted-foreground">{t('workbench.noSources')}</p>}
        {data.sources.map(source => <div className="space-y-2 border-b pb-4" key={source.source_id}><p className="font-medium text-sm break-words">{source.title}</p><label className="relative block cursor-pointer text-xs text-primary focus-within:ring-2 focus-within:ring-ring">{t('workbench.uploadVersion')}<input className="sr-only" type="file" accept=".pdf,.md,.markdown,.txt" onChange={event => { void upload(event.target.files, source.source_id); event.target.value = '' }} /></label>{source.versions.map(version => <div key={version.source_version_id} className={cn("space-y-1 rounded-md p-2", selection.source_version_ids.includes(version.source_version_id) ? "bg-fern-tint" : "bg-muted/40")}><label className="flex gap-2 items-start text-xs"><input aria-label={`${source.title} · ${version.source_version_id}`} type="checkbox" checked={selection.source_version_ids.includes(version.source_version_id)} onChange={event => updateSelection({ source_version_ids: event.target.checked ? [...selection.source_version_ids, version.source_version_id] : selection.source_version_ids.filter(id => id !== version.source_version_id) })} /><span className="min-w-0"><span className="block font-medium">{version.created_at.slice(0, 10)}</span><span className="block truncate text-[10px] text-muted-foreground" title={version.source_version_id}>{version.source_version_id}</span></span></label><div className="flex flex-wrap gap-2 items-center"><span className="text-xs text-muted-foreground">{t(stateKeys[version.status || version.extraction_status || 'pending'] || 'workbench.unavailable')}</span><Button size="sm" variant="ghost" onClick={() => { citationRequest.current++; setCitation(null); setReaderOpen(true); setTab('conversation'); updateSelection({ reading: { source_version_id: version.source_version_id, page_index: 0 } }) }}>{t('workbench.read')}</Button></div>{version.original_status !== 'available' && <p className="text-xs text-muted-foreground">{t('workbench.originalMissing')}</p>}</div>)}</div>)}
        <details ref={googleDisclosure} className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring rounded-sm"><span>{t('workbench.optionalGoogle')}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{t(connectionStatusKey)}</span></summary>
          <div className="mt-3"><NotebookLMPanel notebookId={notebookId} selectedVersionIds={selection.source_version_ids} remoteSourceIds={selection.remote_source_ids} selectionOrigin={selection.selection_origin} link={data.link} onRemoteSelection={ids => updateSelection({ remote_source_ids: ids })} onChanged={refresh} /></div>
        </details>
      </aside>
      <main id="workbench-panel-conversation" className={cn('min-w-0 min-h-0 overflow-auto flex-1 px-4 pb-6 space-y-5 lg:px-6 xl:block', tab !== 'conversation' && 'hidden')}>
        <div className="sticky top-0 z-10 flex gap-2 border-b bg-background py-3"><Button size="sm" variant={readerOpen ? 'default' : 'outline'} onClick={() => setReaderOpen(true)}><BookOpen className="size-4" aria-hidden="true" />{t('workbench.reader')}</Button><Button size="sm" variant={!readerOpen ? 'default' : 'outline'} onClick={() => setReaderOpen(false)}><MessageSquare className="size-4" aria-hidden="true" />{t('workbench.conversation')}</Button></div>
        {!data.sources.length && !hasRemoteContext && !readVersion && !citation && <div className="space-y-2 py-2">
          <h2 className="text-base font-semibold">{t('workbench.startLocalTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('workbench.localToolsHint')}</p>
          <Button size="sm" onClick={() => { setTab('sources'); setFocusUpload(true) }}><Upload className="size-4" aria-hidden="true" />{t('workbench.addStudyMaterials')}</Button>
        </div>}
        {readerOpen && (data.sources.length > 0 || readVersion || citation) && <EvidenceReader sourceVersionId={readVersion} evidenceId={selection.reading?.evidence_id} citation={citation} initialPage={selection.reading?.page_index || 0} onPositionChange={reading => updateSelection({ reading })} onChanged={refresh} />}
        <section className="space-y-4 border-t pt-5" aria-label={t('workbench.conversation')}>
          <div className="rounded-lg border bg-card p-4 space-y-3"><label className="block text-sm font-semibold" htmlFor="workbench-question">{t('workbench.question')}</label><Textarea id="workbench-question" value={question} onChange={event => setQuestion(event.target.value)} rows={3} />
          {selection.engine === 'independent' && <div className="space-y-2">
            <p id="workbench-model-status" role={modelState === 'error' ? 'alert' : 'status'} className="text-xs text-muted-foreground">{t(modelStatusKey)}</p>
            {modelState === 'error' && <Button size="sm" variant="outline" onClick={() => { void modelDefaults.refetch() }}>{t('workbench.retryModelCheck')}</Button>}
            {modelState === 'notConfigured' && <Link href="/settings/models" className="inline-block text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring rounded-sm">{t('workbench.modelSettings')}</Link>}
          </div>}
          {!canAsk && !modelBlocked && <p className="text-xs text-muted-foreground">{googleBlocked || t(selection.engine === 'independent' && selection.selection_origin === 'remote' ? 'workbench.independentLocalOnly' : 'workbench.emptySelection')}</p>}
          <div className="flex flex-wrap gap-2"><Button aria-describedby={selection.engine === 'independent' ? 'workbench-model-status' : undefined} disabled={!canAsk || !question.trim() || ask.isPending || !!pendingTurn} onClick={() => ask.mutate({ message: question.trim() })}>{t('workbench.ask')}</Button><Button aria-describedby={selection.engine === 'independent' ? 'workbench-model-status' : undefined} variant="outline" disabled={!canAsk || ask.isPending || !!pendingTurn} onClick={() => ask.mutate({ message: t('workbench.outlinePrompt'), outline: true, editorSnapshot: { session: noteEditorSession.current, revision: noteEditorRevision.current } })}>{t('workbench.outline')}</Button></div></div>
          {(ask.isPending || pendingTurn) && <p role="status" className="text-sm text-teal">{t('workbench.asking')}</p>}
          {ask.isError && <div role="alert"><p className="text-destructive">{t('workbench.answerFailure')}</p><p className="text-xs">{requestError(ask.error) || t('workbench.unknownSubmission')}</p></div>}
          {pendingStatus.isError && <div role="alert"><p className="text-xs text-destructive">{t('workbench.jobStatusUnavailable')}</p><Button size="sm" variant="outline" onClick={() => pendingStatus.refetch()}>{t('workbench.refreshJob')}</Button></div>}
          {lastJobOutcome && lastJobOutcome.state !== 'succeeded' && <div role="status"><p>{t(stateKeys[lastJobOutcome.state] || 'workbench.unavailable')}</p>{lastJobOutcome.state === 'submission_unknown' && <p className="text-xs text-muted-foreground">{t('workbench.unknownSubmission')}</p>}</div>}
          {history.isError && <div role="alert"><p className="text-xs text-destructive">{requestError(history.error) || t('workbench.error')}</p><Button size="sm" variant="outline" onClick={() => history.refetch()}>{t('workbench.refresh')}</Button></div>}
          <h2 className="font-semibold">{t('workbench.history')}</h2>
          {data.legacy_history?.map(session => <details className="rounded-md border p-3 space-y-2" key={session.chat_session_id}><summary className="text-sm">{t('workbench.importedHistory')}</summary>{session.messages?.map((message, index) => <div key={index} className="border-t py-2 text-sm"><p className="text-xs text-muted-foreground">{message.role}</p>{typeof message.content === 'string' && <MarkdownRenderer>{message.content}</MarkdownRenderer>}</div>)}</details>)}
          {turns.map(turn => <article className="rounded-md border p-4 space-y-3" key={turn.turn_id}><h3 className="font-medium">{turn.message}</h3><details className="text-xs text-muted-foreground"><summary>{t('workbench.turnScope')} · {t(turn.engine === 'independent' ? 'workbench.independent' : 'workbench.notebooklm')}</summary><p className="break-all">{[...(turn.scope_snapshot?.source_version_ids || []), ...(turn.scope_snapshot?.remote_source_ids || [])].join(', ')}</p></details><TurnCoverage coverage={turn.coverage} warnings={turn.warnings} />{turn.answer && <MarkdownRenderer>{turn.answer}</MarkdownRenderer>}{!turn.answer && <p className="text-sm">{t(stateKeys[turn.state || turn.status || 'pending'] || 'workbench.unavailable')}</p>}{!!turn.error && <p className="text-xs text-destructive">{typeof turn.error === 'string' ? turn.error : (turn.error as { message?: string; code?: string }).message || (turn.error as { code?: string }).code || t('workbench.error')}</p>}{turn.state === 'submission_unknown' && <p className="text-sm text-muted-foreground">{t('workbench.unknownSubmission')}</p>}<div className="flex flex-wrap gap-2">{turn.citations?.map(reference => <Button size="sm" variant="outline" key={reference.citation_id} onClick={() => openCitation(reference)}>{reference.source_title} · {reference.citation_id}</Button>)}</div>{turn.answer && <Button size="sm" variant="outline" disabled={note.isPending} onClick={() => saveAnswer(turn)}>{t('workbench.saveAnswer')}</Button>}</article>)}
        </section>
      </main>
      <aside id="workbench-panel-notes" aria-label={t('workbench.notes')} className={cn('min-h-0 overflow-auto border-l bg-card px-4 pb-5 space-y-4 w-full xl:block xl:w-72 2xl:w-80 xl:min-w-56 xl:max-w-[32vw] xl:shrink-0 xl:resize-x', tab !== 'notes' && 'hidden')}>
        <div className="sticky top-0 z-10 flex justify-between items-center gap-2 border-b bg-card py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><NotebookPen className="size-4 text-muted-foreground" aria-hidden="true" />{t('workbench.notes')}</h2><Button size="sm" variant="ghost" onClick={() => { noteEditorSession.current++; setEditingNote(null); setNoteContent(''); setNoteTitle(''); setNoteScope(undefined) }}>{t('common.new')}</Button></div>
        <label className="text-xs block" htmlFor="note-title">{t('workbench.noteTitle')}</label><Input id="note-title" value={noteTitle} onChange={event => { noteEditorRevision.current++; setNoteTitle(event.target.value) }} />
        <label className="text-xs block" htmlFor="note-content">{t('workbench.noteContent')}</label><Textarea id="note-content" className="bg-background leading-6" rows={8} value={noteContent} onChange={event => { noteEditorRevision.current++; setNoteContent(event.target.value) }} />
        <Button size="sm" disabled={!noteContent.trim() || note.isPending} onClick={() => note.mutate({ editorSession: noteEditorSession.current, noteId: editingNote?.id || undefined, title: noteTitle || t('common.note'), content: noteContent, citations: editingNote?.citations || [], scope_snapshot: noteScope || { engine: selection.engine, source_version_ids: selection.selection_origin === 'local' ? [...selection.source_version_ids] : [], remote_source_ids: selection.selection_origin === 'remote' ? [...selection.remote_source_ids] : [], selection_origin: selection.selection_origin } })}>{t('workbench.saveNote')}</Button>
        {!data.notes.length && <p className="text-sm text-muted-foreground">{t('workbench.noNotes')}</p>}
        {data.notes.map(saved => <article key={saved.id} className="rounded-md border p-3 space-y-2"><h3 className="font-medium">{saved.title}</h3><MarkdownRenderer>{saved.content || ''}</MarkdownRenderer>{saved.citations?.map(reference => <Button key={reference.citation_id} size="sm" variant="ghost" onClick={() => openCitation(reference)}>{reference.source_title} · {reference.citation_id}</Button>)}{saved.scope_snapshot && <Button size="sm" variant="outline" onClick={() => { noteEditorSession.current++; setEditingNote(saved); setNoteTitle(saved.title || ''); setNoteContent(saved.content || ''); setNoteScope(saved.scope_snapshot) }}>{t('common.edit')}</Button>}</article>)}
        <JobsPanel jobs={data.jobs || []} onChanged={refresh} />
      </aside>
    </div>
  </div>
}
