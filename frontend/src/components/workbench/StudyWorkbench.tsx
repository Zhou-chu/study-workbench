'use client'
import { isAuthRecoveryError } from '@/lib/api/browser-transport'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { ArrowLeft, BookOpen, Files, MessageSquare, NotebookPen, Search, Upload, Layers, Settings2, MoreHorizontal, Globe2 } from 'lucide-react'
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
import { requestError, requestErrorCode, stateKeys, connectionKeys } from '@/lib/utils/workbench'
import type { BridgeJob, CreateWorkbenchNoteInput, EvidenceCitation, ScopeSnapshot, TurnRecord, WorkbenchNote, WorkbenchSelection } from '@/lib/types/personal'
import { EvidenceReader } from '@/components/evidence/EvidenceReader'
import { NotebookSettingsDialog } from './NotebookSettingsDialog'
import { JobsPanel } from './JobsPanel'
import { PortableControls } from './PortableControls'
import { TurnCoverage } from './TurnCoverage'
import { WorkbenchSourcesList } from './WorkbenchSourcesList'
import { SnapshotPromotionButton } from './SnapshotPromotionButton'
import { WebDiscoveryDialog } from '@/components/sources/WebDiscoveryDialog'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { NoteConflictPanel } from '@/components/common/NoteConflictPanel'
import { noteWriteProblem, canRetryNoteWrite, type NoteWriteProblem } from '@/lib/utils/note-conflict'
import { cn } from '@/lib/utils'

const workspaceTabs = ['sources', 'conversation', 'notes'] as const
const panelLabels = { sources: 'workbench.sources', conversation: 'workbench.readingAndQuestions', notes: 'workbench.notes' }
const panelIcons = { sources: Files, conversation: MessageSquare, notes: NotebookPen }
const emptySelection: WorkbenchSelection = { engine: 'notebooklm', selection_origin: 'local', source_version_ids: [], remote_source_ids: [] }
type NoteSaveInput = CreateWorkbenchNoteInput & { noteId?: string; editorSession?: number; baseRevision?: number | null; answerTurnId?: string }
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
  const readerButton = useRef<HTMLButtonElement | null>(null)
  const focusReader = () => requestAnimationFrame(() => readerButton.current?.focus({ preventScroll: true }))
  const settingsOpener = useRef<HTMLButtonElement | null>(null)
  const discoveryOpener = useRef<HTMLButtonElement | null>(null)
  const openSettings = (event: MouseEvent<HTMLButtonElement>) => { settingsOpener.current = event.currentTarget; setSettingsOpen(true) }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [discoverOpen, setDiscoverOpen] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)
  useEffect(() => {
    if (focusUpload && tab === 'sources') { uploadInput.current?.focus(); setFocusUpload(false) }
  }, [focusUpload, tab])
  const [readerOpen, setReaderOpen] = useState(false)
  const [citation, setCitation] = useState<EvidenceCitation | null>(null)
  const [question, setQuestion] = useState('')
  const questionRevision = useRef(0)
  // A save may finish after New, Edit, or an outline replaced the draft.
  const noteEditorSession = useRef(0)
  const noteSavePending = useRef(false)
  // One unresolved answer operation bounds retained snapshots. Until reviewed,
  // no further answer creation is offered; the independent editor stays usable.
  const answerSaveUncertain = useRef(false)
  const [uncertainAnswer, setUncertainAnswer] = useState<{ turnId: string; snapshot: CreateWorkbenchNoteInput; problem: NoteWriteProblem } | null>(null)
  const [answerCandidates, setAnswerCandidates] = useState<WorkbenchNote[] | null>(null)
  const [answerLatest, setAnswerLatest] = useState<WorkbenchNote | null>(null)
  const [answerComparing, setAnswerComparing] = useState(false)
  const [answerReadFailed, setAnswerReadFailed] = useState(false)
  const noteEditorRevision = useRef(0)
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [editingNote, setEditingNote] = useState<Omit<WorkbenchNote, 'revision'> | null>(null)
  const [baseRevision, setBaseRevision] = useState<number | null>(null)
  const [noteProblem, setNoteProblem] = useState<NoteWriteProblem | null>(null)
  const [latestNotes, setLatestNotes] = useState<WorkbenchNote[] | null>(null)
  const [comparing, setComparing] = useState(false)
  const [compareFailed, setCompareFailed] = useState(false)
  const resetNoteReview = () => { setNoteProblem(null); setLatestNotes(null); setComparing(false); setCompareFailed(false) }
  const [noteScope, setNoteScope] = useState<ScopeSnapshot | undefined>()
  const [pendingJob, setPendingJob] = useState<string | null>(null)
  const [lastJobOutcome, setLastJobOutcome] = useState<BridgeJob | null>(null)
  const [pendingTurn, setPendingTurn] = useState<string | null>(null)
  const [outlineTurn, setOutlineTurn] = useState<({ turnId: string } & NoteEditorSnapshot) | null>(null)
  const sessionId = `v1_${notebookId}`
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workbench(notebookId) })
  const { uploads, upload, retryUpload, dismissUpload } = useWorkbenchUploads(notebookId, refresh)
  const history = useQuery({ queryKey: QUERY_KEYS.personalTurns(sessionId), queryFn: () => workbenchApi.turns(sessionId), enabled: !!pendingTurn, retry: false, refetchInterval: query => !isAuthRecoveryError(query.state.error) && pendingTurn ? 2000 : false })
  const pendingStatus = useQuery({ queryKey: QUERY_KEYS.personalJob(pendingJob || ''), queryFn: ({ signal }) => workbenchApi.job(pendingJob!, signal), enabled: !!pendingJob, retry: false, refetchInterval: query => !isAuthRecoveryError(query.state.error) && activeJob(query.state.data?.state) ? 2000 : false })
  const turns = [...new Map([...(data?.turns || []), ...(history.data || [])].map(turn => [turn.turn_id, turn])).values()]
  const selectedCount = selection.selection_origin === 'local' ? selection.source_version_ids.length : selection.remote_source_ids.length
  // Configuration availability is not an inference or credential health check.
  // A failed refresh must not authorize a turn using stale cached defaults.
  const modelState = modelDefaults.isFetching || modelDefaults.isLoading ? 'loading' :
    modelDefaults.isError ? 'error' : !modelDefaults.data ? 'loading' :
    !modelDefaults.data.default_chat_model ? 'notConfigured' : 'ready'
  const modelStatusKey = { loading: 'workbench.modelChecking', error: 'workbench.modelCheckFailed', notConfigured: 'workbench.notConfigured', ready: 'workbench.modelConfigured' }[modelState]
  const modelBlocked = selection.engine === 'independent' && modelState !== 'ready'
  const showModelStatus = selectedCount > 0 && modelBlocked
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
    mutationFn: ({ message, outline }: { message: string; outline?: boolean; questionRevision?: number; editorSnapshot?: NoteEditorSnapshot }) => workbenchApi.turn(sessionId, {
      task: outline ? 'outline' : 'question', notebook_id: notebookId, engine: selection.engine, selection_origin: selection.selection_origin,
      source_version_ids: selection.selection_origin === 'local' ? [...selection.source_version_ids] : [],
      remote_source_ids: selection.selection_origin === 'remote' ? [...selection.remote_source_ids] : [],
      remote_notebook_id: data?.link?.remote_notebook_id || null, message, idempotency_key: crypto.randomUUID(),
    }), retry: false,
    onSuccess: (turn, variables) => {
      // An outline never owns the question. A submitted question owns only its
      // unchanged draft generation, even if later edits return to the same text.
      if (!variables.outline && variables.questionRevision === questionRevision.current) setQuestion('')
      setLastJobOutcome(null); setPendingJob('job_id' in turn ? turn.job_id : null); setPendingTurn(turn.turn_id); if (variables.outline && variables.editorSnapshot) setOutlineTurn({ turnId: turn.turn_id, ...variables.editorSnapshot }); refresh() },
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
        setBaseRevision(null); resetNoteReview()
        setNoteTitle(t('workbench.outline')); setNoteContent(outline.answer); setNoteScope(outline.scope_snapshot)
        setEditingNote({ id: '', title: '', content: '', citations: outline.citations, scope_snapshot: outline.scope_snapshot })
        setStudioOpen(false); setTab('notes')
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
    mutationFn: (value: NoteSaveInput) => {
      const payload = { title: value.title, content: value.content, citations: value.citations, scope_snapshot: value.scope_snapshot }
      if (value.noteId) {
        if (value.baseRevision == null) throw new Error('Missing captured note revision')
        return workbenchApi.updateNote(notebookId, value.noteId, { ...payload, expected_revision: value.baseRevision })
      }
      return workbenchApi.saveNote(notebookId, payload)
    }, retry: false,
    onSuccess: (saved, value) => {
      refresh()
      if (value.editorSession !== undefined && value.editorSession === noteEditorSession.current) {
        // Acknowledgement advances this session's server base, not its local
        // generation or text: typing while the request was pending stays intact.
        setEditingNote(saved); setBaseRevision(saved.revision); setNoteScope(saved.scope_snapshot ?? value.scope_snapshot); resetNoteReview()
      }
      toast({ title: t('workbench.saved') })
    },
    onSettled: () => { noteSavePending.current = false },
    onError: (error, value) => {
      if (value.editorSession !== undefined && value.editorSession === noteEditorSession.current) setNoteProblem(noteWriteProblem(error))
      else if (value.answerTurnId && noteWriteProblem(error).kind === 'unknown') {
        answerSaveUncertain.current = true
        const { title, content, citations, scope_snapshot } = value
        setUncertainAnswer({ turnId: value.answerTurnId, snapshot: structuredClone({ title, content, citations, scope_snapshot }), problem: noteWriteProblem(error) })
      } else toast({ title: requestError(error) || t('workbench.error'), variant: 'destructive' })
    },
  })
  const submitNote = (value: NoteSaveInput) => {
    // React Query's pending render can lag a second click in the same turn.
    if (noteSavePending.current || (value.answerTurnId && answerSaveUncertain.current)) return
    noteSavePending.current = true
    note.mutate(value)
  }
  const compareAnswer = async () => {
    if (!uncertainAnswer || answerComparing) return
    setAnswerComparing(true); setAnswerReadFailed(false); setAnswerLatest(null)
    try { setAnswerCandidates((await workbenchApi.workspace(notebookId)).notes) }
    catch { setAnswerReadFailed(true) }
    finally { setAnswerComparing(false) }
  }
  const compareNote = async () => {
    const session = noteEditorSession.current
    setComparing(true); setCompareFailed(false)
    try {
      const latest = await workbenchApi.workspace(notebookId)
      if (session === noteEditorSession.current) setLatestNotes(editingNote?.id ? latest.notes.filter(item => item.id === editingNote.id) : latest.notes)
    } catch { if (session === noteEditorSession.current) setCompareFailed(true) }
    finally { if (session === noteEditorSession.current) setComparing(false) }
  }
  const reloadNote = () => {
    const latest = latestNotes?.[0]
    if (!latest || latest.id !== editingNote?.id) return
    noteEditorSession.current++
    setEditingNote(latest); setBaseRevision(latest.revision); setNoteTitle(latest.title); setNoteContent(latest.content); setNoteScope(latest.scope_snapshot); resetNoteReview()
  }
  const openCitation = async (reference: EvidenceCitation) => {
    const request = ++citationRequest.current
    setCitation(reference); setReaderOpen(true); setTab('conversation'); focusReader()
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
  const saveAnswer = (turn: TurnRecord) => submitNote({ answerTurnId: turn.turn_id, title: turn.message, content: turn.answer || '', citations: turn.citations || [], scope_snapshot: turn.scope_snapshot })
  if (workspace.isLoading) return <p className="p-6" role="status">{t('common.loading')}</p>
  if (!data) return <div className="p-6 space-y-3"><p role="alert">{requestError(workspace.error) || t('workbench.serviceError')}</p><Button onClick={() => workspace.refetch()}>{t('workbench.retry')}</Button></div>
  const readVersion = citation?.kind === 'remote_unmapped' ? undefined : selection.reading?.source_version_id
  const hasRemoteContext = Boolean(data.link?.remote_notebook_id) || (selection.selection_origin === 'remote' && selection.remote_source_ids.length > 0)
  const unmappedSources = requestErrorCode(ask.error) === 'UNMAPPED_SOURCE' || requestErrorCode(lastJobOutcome?.error) === 'UNMAPPED_SOURCE'
  const hasUnsavedNote = (saved: WorkbenchNote) => editingNote?.id === saved.id && (note.isPending || !!noteProblem || baseRevision !== saved.revision || noteContent !== (saved.content || '') || (noteTitle || t('common.note')) !== (saved.title || t('common.note')))
  return <div aria-label={t('learningWorkspace.workspace')} className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
    <header className="shrink-0 border-b bg-card px-4 py-3 lg:px-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/notebooks" aria-label={t('navigation.notebooks')} className="rounded-md p-2 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="size-4" aria-hidden="true" /></Link>
          <div className="min-w-0"><h1 className="truncate font-display text-xl font-semibold tracking-tight" title={data.notebook.name}>{data.notebook.name}</h1><p className="mt-0.5 text-xs text-muted-foreground">{t('workbench.title')}</p></div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="icon" variant="ghost" aria-label={t('learningWorkspace.notebookSettings')} onClick={openSettings}><Settings2 className="size-4" aria-hidden="true" /></Button>
          <details className="relative"><summary aria-label={t('learningWorkspace.notebookTools')} className="list-none cursor-pointer rounded-md p-2 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><MoreHorizontal className="size-4" aria-hidden="true" /></summary><div className="absolute right-0 top-full z-30 mt-2 w-72 max-w-[85vw] space-y-3 rounded-lg border bg-card p-4 shadow-pop"><PortableControls notebookId={notebookId} onChanged={refresh} /><Link href={`/notebooks/${encodeURIComponent(notebookId)}`} target="_blank" rel="noopener noreferrer" className="block text-sm text-primary hover:underline">{t('learningWorkspace.classicNotebook')}</Link><p className="text-xs leading-5 text-muted-foreground">{t('learningWorkspace.classicDescription')}</p></div></details>
        </div>
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
        <label className="relative flex cursor-pointer items-center justify-center gap-2 rounded-md border border-primary/30 bg-card px-3 py-3 text-sm font-medium text-primary focus-within:ring-2 focus-within:ring-ring"><Upload className="size-4" aria-hidden="true" /><span>{t('workbench.upload')}</span><input ref={uploadInput} className="sr-only" type="file" accept=".pdf,.md,.markdown,.txt" multiple onChange={event => { void upload(event.target.files); event.target.value = '' }} /></label>
        <Button className="w-full gap-2" variant="outline" ref={discoveryOpener} onClick={() => setDiscoverOpen(true)}><Globe2 className="size-4" aria-hidden="true" />{t('learningWorkspace.discover')}</Button>
        {uploads.map(item => <div key={item.id} className="space-y-1 text-xs"><p className="break-all" role="status">{item.name}: {t({ uploading: 'workbench.uploading', uploadAccepted: 'workbench.uploadAccepted', uploadFailed: 'workbench.uploadFailed', uploadUncertain: 'workbench.uploadUncertain' }[item.state])}{item.error && ` · ${item.error}`}</p>{item.state !== 'uploading' && <div className="flex flex-wrap gap-2">{item.state !== 'uploadAccepted' && <Button size="sm" variant="outline" onClick={() => { void retryUpload(item.id) }}>{t('workbench.retryUpload')}</Button>}<Button size="sm" variant="ghost" onClick={() => dismissUpload(item.id)}>{t('workbench.dismissUpload')}</Button></div>}{item.state === 'uploadUncertain' && <p className="text-muted-foreground">{t('workbench.uploadRecoveryHint')}</p>}</div>)}
        <p className="text-xs leading-5 text-muted-foreground">{t('learningWorkspace.sourcesHint')}</p>
        {selection.selection_origin === 'remote' && <Button size="sm" variant="outline" onClick={openSettings}>{t('workbench.remoteScope')}</Button>}
        <div className="flex flex-wrap gap-1"><Button size="sm" variant="ghost" onClick={() => updateSelection({ source_version_ids: data.sources.flatMap(source => source.versions.length ? [[...source.versions].sort((a, b) => b.created_at.localeCompare(a.created_at))[0].source_version_id] : []), selection_origin: 'local' })}>{t('workbench.selectAll')}</Button><Button size="sm" variant="ghost" onClick={() => updateSelection({ source_version_ids: [], remote_source_ids: [] })}>{t('workbench.clearSelection')}</Button></div>
        <label htmlFor="workspace-search" className="text-xs flex items-center gap-1.5"><Search className="size-3.5" aria-hidden="true" />{t('learningWorkspace.sourceSearch')}</label><Input id="workspace-search" value={searchText} onChange={event => setSearchText(event.target.value)} /><Button size="sm" variant="outline" disabled={!searchText.trim() || !selection.source_version_ids.length || search.isPending} onClick={() => search.mutate()}>{t('workbench.search')}</Button>
        {search.isError && <p role="alert" className="text-xs text-destructive">{requestError(search.error) || t('workbench.error')}</p>}
        {search.data?.hits.map(hit => <button key={hit.evidence_id} className="w-full rounded border p-2 text-left text-xs hover:bg-muted" onClick={() => openCitation({ citation_id: hit.evidence_id, evidence_id: hit.evidence_id, source_version_id: hit.source_version_id, source_title: hit.source_title || hit.source_version_id, kind: hit.evidence_kind === 'derived_snapshot' ? 'derived_snapshot' : hit.evidence_kind === 'remote_text_snapshot' ? 'remote_text_snapshot' : 'local_evidence', provenance: hit.provenance, independent_support: hit.independent_support, locator: hit.locator, quote: hit.quote, reference_validity: hit.reference_validity || 'unverified' })}>{hit.quote}</button>)}
        {!data.sources.length && <p className="text-sm text-muted-foreground">{t('workbench.noSources')}</p>}
        <WorkbenchSourcesList notebookId={notebookId} sources={data.sources} selectedVersionIds={selection.source_version_ids} onSelectionChange={ids => updateSelection({ source_version_ids: ids })} onRead={id => { citationRequest.current++; setCitation(null); setReaderOpen(true); setTab('conversation'); focusReader(); updateSelection({ reading: { source_version_id: id, page_index: 0 } }) }} onUpload={(files, id) => { void upload(files, id) }} />
      </aside>
      <div id="workbench-panel-conversation" className={cn('min-w-0 min-h-0 overflow-auto flex-1 px-4 pb-6 space-y-5 lg:px-6 xl:block', tab !== 'conversation' && 'hidden')}>
        <div className="sticky top-0 z-10 flex gap-2 border-b bg-background py-3"><Button ref={readerButton} size="sm" variant={readerOpen ? 'default' : 'outline'} onClick={() => setReaderOpen(true)}><BookOpen className="size-4" aria-hidden="true" />{t('workbench.reader')}</Button><Button size="sm" variant={!readerOpen ? 'default' : 'outline'} onClick={() => setReaderOpen(false)}><MessageSquare className="size-4" aria-hidden="true" />{t('workbench.conversation')}</Button></div>
        {!data.sources.length && !hasRemoteContext && !readVersion && !citation && <div className="space-y-2 py-2">
          <h2 className="text-base font-semibold">{t('workbench.startLocalTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('workbench.localToolsHint')}</p>
          <Button size="sm" onClick={() => { setTab('sources'); setFocusUpload(true) }}><Upload className="size-4" aria-hidden="true" />{t('workbench.addStudyMaterials')}</Button>
        </div>}
        {(data.sources.length > 0 || readVersion || citation) && <div className={cn(!readerOpen && 'hidden')}><EvidenceReader sourceVersionId={readVersion} evidenceId={selection.reading?.evidence_id} citation={citation} initialPage={selection.reading?.page_index || 0} onPositionChange={reading => updateSelection({ reading })} onChanged={refresh} /></div>}
        <section className={cn("space-y-4", readerOpen && "hidden")} aria-label={t('workbench.conversation')}>
          <div className="rounded-lg border bg-card p-4 space-y-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Layers className="size-3.5" aria-hidden="true" />{t('workbench.selectedCount', { count: selectedCount })}</p><label className="block text-sm font-semibold" htmlFor="workbench-question">{t('workbench.question')}</label><Textarea id="workbench-question" value={question} onChange={event => { questionRevision.current++; setQuestion(event.target.value) }} rows={3} />
          {showModelStatus && <div className="space-y-2">
            <p id="workbench-model-status" role={modelState === 'error' ? 'alert' : 'status'} className="text-xs text-muted-foreground">{t(modelStatusKey)}</p>
            {modelState === 'error' && <Button size="sm" variant="outline" onClick={() => { void modelDefaults.refetch() }}>{t('workbench.retryModelCheck')}</Button>}
            {modelState === 'notConfigured' && <Button size="sm" variant="ghost" onClick={openSettings}>{t('workbench.modelSettings')}</Button>}
          </div>}
          {selectedCount === 0 && <p className="text-xs text-muted-foreground">{t('workbench.emptySelection')}</p>}
          {selectedCount > 0 && !canAsk && !modelBlocked && <p className="text-xs text-muted-foreground">{googleBlocked || t(selection.engine === 'independent' && selection.selection_origin === 'remote' ? 'workbench.independentLocalOnly' : 'workbench.emptySelection')}</p>}
          {selectedCount > 0 && googleBlocked && <Button size="sm" variant="outline" onClick={openSettings}>{t('navigation.settings')}</Button>}
          <div className="flex flex-wrap gap-2"><Button aria-describedby={showModelStatus ? 'workbench-model-status' : undefined} disabled={!canAsk || !question.trim() || ask.isPending || !!pendingTurn} onClick={() => ask.mutate({ message: question.trim(), questionRevision: questionRevision.current })}>{t('workbench.ask')}</Button><Button aria-describedby={showModelStatus ? 'workbench-model-status' : undefined} variant="outline" disabled={!canAsk || ask.isPending || !!pendingTurn} onClick={() => ask.mutate({ message: t('workbench.outlinePrompt'), outline: true, editorSnapshot: { session: noteEditorSession.current, revision: noteEditorRevision.current } })}>{t('workbench.outline')}</Button></div></div>
          {(ask.isPending || pendingTurn) && <p role="status" className="text-sm text-teal">{t('workbench.asking')}</p>}
          {ask.isError && <div role="alert"><p className="text-destructive">{t('workbench.answerFailure')}</p>{!unmappedSources && <p className="text-xs">{requestError(ask.error) || t('workbench.unknownSubmission')}</p>}</div>}
          {unmappedSources && <div role="alert" className="space-y-2"><p className="text-sm leading-6 text-muted-foreground">{t('learningWorkspace.unmappedSources')}</p><Button size="sm" variant="outline" onClick={openSettings}>{t('navigation.settings')}</Button></div>}
          {pendingStatus.isError && <div role="alert"><p className="text-xs text-destructive">{t('workbench.jobStatusUnavailable')}</p><Button size="sm" variant="outline" onClick={() => pendingStatus.refetch()}>{t('workbench.refreshJob')}</Button></div>}
          {lastJobOutcome && lastJobOutcome.state !== 'succeeded' && <div role="status"><p>{t(stateKeys[lastJobOutcome.state] || 'workbench.unavailable')}</p>{lastJobOutcome.state === 'submission_unknown' && <p className="text-xs text-muted-foreground">{t('workbench.unknownSubmission')}</p>}</div>}
          {history.isError && <div role="alert"><p className="text-xs text-destructive">{requestError(history.error) || t('workbench.error')}</p><Button size="sm" variant="outline" onClick={() => history.refetch()}>{t('workbench.refresh')}</Button></div>}
          {uncertainAnswer && <div className="space-y-3" data-answer-turn={uncertainAnswer.turnId}>
            <h3 className="font-medium break-words">{uncertainAnswer.snapshot.title}</h3>
            <NoteConflictPanel problem={uncertainAnswer.problem} baseRevision={null} draft={uncertainAnswer.snapshot} latest={answerLatest ? [answerLatest] : null} loading={answerComparing} readFailed={answerReadFailed} onCompare={compareAnswer} />
            {answerCandidates && <section className="space-y-2" aria-label={t('noteConflict.candidates')}><h3 className="text-sm font-medium">{t('noteConflict.candidates')}</h3>{answerCandidates.length ? answerCandidates.map(candidate => <Button key={candidate.id} type="button" variant="outline" size="sm" className="block max-w-full truncate" disabled={answerComparing} aria-label={`${t('noteConflict.inspectCandidate')}: ${candidate.title || t('sources.untitledNote')}`} onClick={() => setAnswerLatest(candidate)}>{candidate.title || t('sources.untitledNote')}</Button>) : <p className="text-sm text-muted-foreground">{t('noteConflict.notFound')}</p>}</section>}
          </div>}
          {!turns.length && <div className="space-y-2 py-6"><h2 className="text-base font-medium">{t(selectedCount ? 'workbench.conversation' : 'learningWorkspace.selectSources')}</h2><p className="max-w-prose text-sm leading-6 text-muted-foreground">{t('learningWorkspace.chatEmpty')}</p></div>}
          {!!turns.length && <h2 className="text-sm font-semibold text-muted-foreground">{t('workbench.history')}</h2>}
          {data.legacy_history?.map(session => <details className="rounded-md border p-3 space-y-2" key={session.chat_session_id}><summary className="text-sm">{t('workbench.importedHistory')}</summary>{session.messages?.map((message, index) => <div key={index} className="border-t py-2 text-sm"><p className="text-xs text-muted-foreground">{message.role}</p>{typeof message.content === 'string' && <MarkdownRenderer>{message.content}</MarkdownRenderer>}</div>)}</details>)}
          {turns.map(turn => <article className="rounded-md border p-4 space-y-3" key={turn.turn_id}><h3 className="font-medium">{turn.message}</h3><details className="text-xs text-muted-foreground"><summary>{t('workbench.turnScope')} · {t(turn.engine === 'independent' ? 'workbench.independent' : 'workbench.notebooklm')}</summary><p className="break-all">{[...(turn.scope_snapshot?.source_version_ids || []), ...(turn.scope_snapshot?.remote_source_ids || [])].join(', ')}</p></details><TurnCoverage coverage={turn.coverage} warnings={turn.warnings} />{turn.answer && <MarkdownRenderer>{turn.answer}</MarkdownRenderer>}{!turn.answer && <p className="text-sm">{t(stateKeys[turn.state || turn.status || 'pending'] || 'workbench.unavailable')}</p>}{!!turn.error && <p className="text-xs text-destructive">{typeof turn.error === 'string' ? turn.error : (turn.error as { message?: string; code?: string }).message || (turn.error as { code?: string }).code || t('workbench.error')}</p>}{turn.state === 'submission_unknown' && <p className="text-sm text-muted-foreground">{t('workbench.unknownSubmission')}</p>}<div className="flex flex-wrap gap-2">{turn.citations?.map(reference => <Button size="sm" variant="outline" key={reference.citation_id} onClick={() => openCitation(reference)}>{reference.source_title} · {reference.citation_id}</Button>)}</div>{turn.answer && <Button size="sm" variant="outline" disabled={note.isPending || !!uncertainAnswer} onClick={() => saveAnswer(turn)}>{t('workbench.saveAnswer')}</Button>}{turn.answer && (!turn.state || turn.state === 'succeeded') && (!turn.status || turn.status === 'succeeded') && <SnapshotPromotionButton notebookId={notebookId} origin={{ kind: 'turn', id: turn.turn_id }} onAdded={refresh} />}</article>)}
        </section>
      </div>
      <aside id="workbench-panel-notes" aria-label={t('workbench.notes')} className={cn('min-h-0 overflow-auto border-l bg-card px-4 pb-5 space-y-4 w-full xl:block xl:w-72 2xl:w-80 xl:min-w-56 xl:max-w-[32vw] xl:shrink-0 xl:resize-x', tab !== 'notes' && 'hidden')}>
        <div className="sticky top-0 z-10 flex justify-between items-center gap-2 border-b bg-card py-3"><div className="flex gap-1"><Button size="sm" variant={studioOpen ? 'ghost' : 'secondary'} aria-pressed={!studioOpen} onClick={() => setStudioOpen(false)}>{t('learningWorkspace.notesTab')}</Button><Button size="sm" variant={studioOpen ? 'secondary' : 'ghost'} aria-pressed={studioOpen} onClick={() => setStudioOpen(true)}>{t('learningWorkspace.studioTab')}</Button></div><Button size="sm" variant="ghost" onClick={() => { setStudioOpen(false); noteEditorSession.current++; setBaseRevision(null); resetNoteReview(); setEditingNote(null); setNoteContent(''); setNoteTitle(''); setNoteScope(undefined) }}>{t('common.new')}</Button></div>
        <div className={cn("space-y-4", studioOpen && "hidden")}><label className="text-xs block" htmlFor="note-title">{t('workbench.noteTitle')}</label><Input id="note-title" value={noteTitle} onChange={event => { noteEditorRevision.current++; setNoteTitle(event.target.value) }} />
        <label className="text-xs block" htmlFor="note-content">{t('workbench.noteContent')}</label><Textarea id="note-content" className="bg-background leading-6" rows={8} value={noteContent} onChange={event => { noteEditorRevision.current++; setNoteContent(event.target.value) }} />
        <Button size="sm" disabled={!noteContent.trim() || note.isPending || !canRetryNoteWrite(noteProblem) || (!!editingNote?.id && baseRevision == null)} onClick={() => submitNote({ editorSession: noteEditorSession.current, baseRevision, noteId: editingNote?.id || undefined, title: noteTitle || t('common.note'), content: noteContent, citations: editingNote?.citations || [], scope_snapshot: noteScope || { engine: selection.engine, source_version_ids: selection.selection_origin === 'local' ? [...selection.source_version_ids] : [], remote_source_ids: selection.selection_origin === 'remote' ? [...selection.remote_source_ids] : [], selection_origin: selection.selection_origin } })}>{t('workbench.saveNote')}</Button>
        {noteProblem && <NoteConflictPanel problem={noteProblem} baseRevision={baseRevision} draft={{ title: noteTitle, content: noteContent, citations: editingNote?.citations, scope_snapshot: noteScope }} latest={latestNotes} loading={comparing} readFailed={compareFailed} onCompare={compareNote} onReload={editingNote?.id ? reloadNote : undefined} />}
        {!data.notes.length && <p className="text-sm text-muted-foreground">{t('learningWorkspace.notesEmpty')}</p>}
        {data.notes.map(saved => <article key={saved.id} className="rounded-md border p-3 space-y-2"><h3 className="font-medium">{saved.title}</h3><MarkdownRenderer>{saved.content || ''}</MarkdownRenderer>{saved.citations?.map(reference => <Button key={reference.citation_id} size="sm" variant="ghost" onClick={() => openCitation(reference)}>{reference.source_title} · {reference.citation_id}</Button>)}{Number.isInteger(saved.revision) && <Button size="sm" variant="outline" onClick={() => { noteEditorSession.current++; setBaseRevision(saved.revision); resetNoteReview(); setEditingNote(saved); setNoteTitle(saved.title || ''); setNoteContent(saved.content || ''); setNoteScope(saved.scope_snapshot) }}>{t('common.edit')}</Button>}{Number.isInteger(saved.revision) && <fieldset disabled={hasUnsavedNote(saved)}><SnapshotPromotionButton notebookId={notebookId} origin={{ kind: 'note', id: saved.id, revision: saved.revision }} onAdded={refresh} /></fieldset>}{hasUnsavedNote(saved) && <p className="text-xs text-muted-foreground">{t('sourceSnapshots.saveFirst')}</p>}</article>)}
        </div><div className={cn("space-y-4", !studioOpen && "hidden")}><p className="text-xs leading-5 text-muted-foreground">{t('learningWorkspace.studioDescription')}</p><JobsPanel jobs={data.jobs || []} onChanged={refresh} /></div>
      </aside>
    </div>
    <WebDiscoveryDialog key={notebookId} onCloseAutoFocus={event => { event.preventDefault(); discoveryOpener.current?.focus() }} notebookId={notebookId} open={discoverOpen} onOpenChange={setDiscoverOpen} onImported={refresh} />
    <NotebookSettingsDialog notebookId={notebookId} open={settingsOpen} onOpenChange={setSettingsOpen} onCloseAutoFocus={event => { event.preventDefault(); settingsOpener.current?.focus() }} selection={selection} onSelectionChange={updateSelection} link={data.link} onChanged={refresh} modelStatus={modelStatusKey} connectionStatus={connectionStatusKey} />
  </div>
}
