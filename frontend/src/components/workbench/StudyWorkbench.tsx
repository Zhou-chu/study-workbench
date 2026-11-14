'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { ArrowLeft, BookOpen, Files, MessageSquare, NotebookPen, Upload, Layers, Settings2, MoreHorizontal, Globe2 } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { evidenceApi } from '@/lib/api/evidence'
import { useModelDefaults } from '@/lib/hooks/use-models'
import { useNotebookLMStatus, useNotebookLMCapabilities } from '@/lib/hooks/use-notebooklm'
import { useWorkbenchUploads } from '@/lib/hooks/use-workbench-uploads'
import { EmbeddingIdentity } from './EmbeddingIdentity'
import { SemanticIndexPanel } from './SemanticIndexPanel'
import { useWorkbenchRetrieval } from '@/lib/hooks/use-workbench-retrieval'
import { semanticOptionsAllowed } from '@/lib/hooks/use-semantic-status'
import { useWorkbenchEvidenceSearch } from '@/lib/hooks/use-workbench-evidence-search'
import { workbenchApi } from '@/lib/api/workbench'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useSaveWorkbenchSelection, useWorkbench } from '@/lib/hooks/use-workbench'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useToast } from '@/lib/hooks/use-toast'
import { newestSelectableVersionId, projectWorkbenchSelection, projectWorkbenchVersion } from '@/lib/utils/workbench-read-model'
import { canonicalCitationLocator } from '@/lib/utils/evidence'
import { requestError, stateKeys, embeddingDestinationKeys, connectionKeys, isKnownEngine, isKnownSelectionOrigin } from '@/lib/utils/workbench'
import type { CreateWorkbenchNoteInput, EvidenceCitation, ReadingPosition, ScopeSnapshot, TurnRecord, WorkbenchNote, WorkbenchSelection, Workspace, WorkspaceSelection } from '@/lib/types/personal'
import { EvidenceReader } from '@/components/evidence/EvidenceReader'
import { NotebookSettingsDialog } from './NotebookSettingsDialog'
import { JobsPanel } from './JobsPanel'
import { TurnRecoveryPanel } from './TurnRecoveryPanel'
import { useWorkbenchTurn } from '@/lib/hooks/use-workbench-turn'
import { PortableControls } from './PortableControls'
import { TurnCoverage } from './TurnCoverage'
import { selectedSourceBlockers } from '@/lib/utils/workbench-readiness'
import { SelectedSourceReadiness } from './SelectedSourceReadiness'
import { WorkbenchSourcesList } from './WorkbenchSourcesList'
import { WorkbenchSearchResult } from './WorkbenchSearchResult'
import { versionPrefix } from '@/lib/utils/workbench-labels'
import { WorkbenchCitationButton } from './WorkbenchCitationButton'
import { SnapshotPromotionButton } from './SnapshotPromotionButton'
import { WebDiscoveryDialog } from '@/components/sources/WebDiscoveryDialog'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { NoteDraftTransitionDialog, type NoteTransitionKind } from './NoteDraftTransitionDialog'
import { readTurnContext } from '@/lib/workbench/turn-context'
import { NoteConflictPanel } from '@/components/common/NoteConflictPanel'
import { noteWriteProblem, canRetryNoteWrite, type NoteWriteProblem } from '@/lib/utils/note-conflict'
import { cn } from '@/lib/utils'

const workspaceTabs = ['sources', 'conversation', 'notes'] as const
const panelLabels = { sources: 'workbench.sources', conversation: 'workbench.readingAndQuestions', notes: 'workbench.notes' }
const panelIcons = { sources: Files, conversation: MessageSquare, notes: NotebookPen }
const emptySelection = { engine: 'notebooklm', selection_origin: 'local', source_version_ids: [], remote_source_ids: [] }
type NoteTransitionIntent = { kind: NoteTransitionKind; notebookId: string; session: number; revision: number; saveEpoch: number; target: string; noteId?: string }
type NoteSaveInput = CreateWorkbenchNoteInput & { noteId?: string; editorSession?: number; baseRevision?: number | null; answerTurnId?: string }
export function StudyWorkbench({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const workspace = useWorkbench(notebookId)
  const connection = useNotebookLMStatus()
  const capabilities = useNotebookLMCapabilities()
  const modelDefaults = useModelDefaults()
  const data = workspace.data
  const [draft, setDraft] = useState<{ notebookId: string; selection: WorkspaceSelection } | null>(null)
  const rawSelection = (draft?.notebookId === notebookId ? draft.selection : null) ?? data?.selection ?? null
  const saveSelection = useSaveWorkbenchSelection(notebookId, rawSelection)
  const selection = useMemo(() => projectWorkbenchSelection(rawSelection), [rawSelection])
  const localRetrieval = selection.engine === 'independent' && selection.selection_origin === 'local'
  const retrieval = useWorkbenchRetrieval(notebookId, localRetrieval ? selection.source_version_ids : [])
  const search = useWorkbenchEvidenceSearch(notebookId, rawSelection, data?.sources, localRetrieval ? retrieval.options : undefined, retrieval.readGeneration)
  const selectionRef = useRef(rawSelection)
  const citationRequest = useRef(0)
  selectionRef.current = rawSelection
  const workspaceReadPending = useRef(false)
  const retryWorkspaceRead = () => {
    if (workspaceReadPending.current || workspace.isFetching) return
    workspaceReadPending.current = true
    void workspace.refetch({ cancelRefetch: false }).finally(() => { workspaceReadPending.current = false })
  }
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
  const [mountId] = useState<string | null>(() => {
    try { return crypto.randomUUID() } catch { return null }
  })
  const [question, setQuestion] = useState('')
  const questionRevision = useRef(0)
  const requestView = useRef({ fingerprint: '', generation: 0 })
  const currentRequestGeneration = useCallback(() => {
    const view = projectWorkbenchSelection(selectionRef.current)
    const fingerprint = JSON.stringify([notebookId, view.engine, view.selection_origin, view.source_version_ids, view.remote_source_ids, retrieval.readGeneration()])
    if (requestView.current.fingerprint !== fingerprint) requestView.current = { fingerprint, generation: requestView.current.generation + 1 }
    return requestView.current.generation
  }, [notebookId, retrieval])
  currentRequestGeneration()
  // A save may finish after New, Edit, or an outline replaced the draft.
  const noteEditorSession = useRef(0)
  const noteSavePending = useRef(false)
  const noteSaveEpoch = useRef(0)
  const noteProblemRef = useRef<NoteWriteProblem | null>(null)
  const noteTitleInput = useRef<HTMLInputElement>(null)
  const noteTransitionOpener = useRef<HTMLButtonElement | null>(null)
  const noteTransitionRef = useRef<NoteTransitionIntent | null>(null)
  const [noteTransition, setNoteTransition] = useState<NoteTransitionIntent | null>(null)
  const [noteTransitionNotice, setNoteTransitionNotice] = useState<string | null>(null)
  const [focusNoteEditor, setFocusNoteEditor] = useState(false)
  const transitionFocus = useRef(false)
  useEffect(() => {
    if (focusNoteEditor && tab === 'notes' && !studioOpen) {
      requestAnimationFrame(() => { noteTitleInput.current?.focus() })
      setFocusNoteEditor(false)
    }
  }, [focusNoteEditor, tab, studioOpen])
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
  const resetNoteReview = () => { noteSaveEpoch.current++; noteProblemRef.current = null; setNoteProblem(null); setLatestNotes(null); setComparing(false); setCompareFailed(false) }
  const [noteScope, setNoteScope] = useState<ScopeSnapshot | undefined>()
  const sessionId = `v1_${notebookId}`
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workbench(notebookId) })
  const { uploads, upload, retryUpload, dismissUpload } = useWorkbenchUploads(notebookId, refresh)
  const knownOrigin = isKnownSelectionOrigin(selection.selection_origin)
  const selectedCount = selection.selection_origin === 'local' ? selection.source_version_ids.length : selection.selection_origin === 'remote' ? selection.remote_source_ids.length : 0
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
  const knownEngine = isKnownEngine(selection.engine)
  // Repeated source records retain duplicate identity labels; repeated excerpts
  // of one absent version add that version only once to the display namespace.
  const sourceVersionIds = data?.sources.flatMap(source => source.versions.flatMap(raw => projectWorkbenchVersion(raw).source_version_id ?? [])) ?? []
  const displayedVersionIds = [...sourceVersionIds, ...new Set(search.hits.map(hit => hit.source_version_id).filter(id => !sourceVersionIds.includes(id)))]
  const sourceBlockers = selection.selection_origin === 'local' ? selectedSourceBlockers(selection.source_version_ids, data?.sources) : []
  const canAsk = sourceBlockers.length === 0 && selection.supported && knownEngine && knownOrigin && selectedCount > 0 && !modelBlocked && !googleBlocked && !(selection.engine === 'independent' && selection.selection_origin === 'remote')
  const updateSelection = (patch: Partial<WorkbenchSelection>) => {
    if (!saveSelection.ownsIntent()) return
    const next = { ...(selectionRef.current ?? emptySelection), ...patch }
    selectionRef.current = next
    search.selectionChanged(next)
    currentRequestGeneration()
    setDraft({ notebookId, selection: next })
    saveSelection.mutate(next)
  }
  const changeReadingPosition = (reading: ReadingPosition) => {
    // Retired handlers cannot supersede a current citation jump. Once admitted,
    // explicit reading navigation wins over any older pending locator lookup.
    if (!saveSelection.ownsIntent()) return
    citationRequest.current++
    updateSelection({ reading })
  }
  const currentNoteScope: ScopeSnapshot | undefined = selection.supported && isKnownEngine(selection.engine) && isKnownSelectionOrigin(selection.selection_origin) ? { engine: selection.engine, selection_origin: selection.selection_origin, source_version_ids: selection.selection_origin === 'local' ? [...selection.source_version_ids] : [], remote_source_ids: selection.selection_origin === 'remote' ? [...selection.remote_source_ids] : [] } : undefined
  const recovery = useWorkbenchTurn(notebookId, { independentAvailable: modelState === 'ready', googleAvailable: !connection.isError && !capabilities.isError && connection.data?.state === 'connected' && askCapability?.support === 'available', googleLink: data?.link ?? null })
  const turns = [...new Map([...(data?.turns || []), ...recovery.turns].map(turn => [turn.turn_id, turn])).values()]
  const submitTurn = (outline: boolean) => {
    const current = projectWorkbenchSelection(selectionRef.current)
    const latestWorkspace = queryClient.getQueryData<Workspace>(QUERY_KEYS.workbench(notebookId)) ?? data
    // Engine/origin availability belongs to the rendered configuration; scope
    // IDs must be read synchronously so a checkbox edit cannot submit old IDs.
    if (mountId === null || !canAsk || !current.supported || !isKnownEngine(current.engine) || !isKnownSelectionOrigin(current.selection_origin) || current.engine !== selection.engine || current.selection_origin !== selection.selection_origin) return
    if (current.selection_origin === 'local' ? !current.source_version_ids.length || selectedSourceBlockers(current.source_version_ids, latestWorkspace?.sources).length > 0 : !current.remote_source_ids.length) return
    const localOptions = current.engine === 'independent' && current.selection_origin === 'local'
    const options = localOptions ? retrieval.readOptions() : {}
    if ((outline && options.retrieval_mode === 'hybrid') || !semanticOptionsAllowed(queryClient, notebookId, current.source_version_ids, options)) return
    const embeddingDisclosure = options.retrieval_mode === 'hybrid' ? retrieval.readDisclosure() : null
    if (options.retrieval_mode === 'hybrid' && !embeddingDisclosure) return
    recovery.submit({ sessionId, ...(embeddingDisclosure ? { embeddingDisclosure } : {}), available: canAsk && (!localOptions || retrieval.available),
      owner: { mountId, requestGeneration: currentRequestGeneration(), ...(outline ? { editor: { session: noteEditorSession.current, revision: noteEditorRevision.current } } : { questionRevision: questionRevision.current }) },
      ...(data?.link?.connection_id ? { googleConnectionId: data.link.connection_id } : {}),
      request: { ...options, task: outline ? 'outline' : 'question', notebook_id: notebookId, engine: current.engine, selection_origin: current.selection_origin,
        source_version_ids: current.selection_origin === 'local' ? [...current.source_version_ids] : [],
        remote_source_ids: current.selection_origin === 'remote' ? [...current.remote_source_ids] : [],
        remote_notebook_id: data?.link?.remote_notebook_id || null, message: outline ? t('workbench.outlinePrompt') : question.trim() },
    })
  }
  useEffect(() => {
    const operation = recovery.operation
    if (!operation || !recovery.isCurrent(operation.token)) return
    const owner = operation.capture.owner
    // A failed allocation is never an owner, even across failed remounts.
    const originalMount = mountId !== null && owner.mountId === mountId
    const originalView = owner.requestGeneration === currentRequestGeneration()
    // Acceptance belongs to a draft generation, not to text equality. Trusted
    // completion can also acknowledge an Ask whose original POST ACK was lost.
    if ((recovery.acceptance || recovery.completion) && originalMount && originalView && operation.capture.dto.task === 'question' && owner.questionRevision === questionRevision.current) {
      questionRevision.current++
      setQuestion('')
    }
    if (operation.phase !== 'complete') return
    const completion = recovery.completion
    if (completion && recovery.isCurrent(completion.token)) {
      // A later save may require reconciliation even when no text was edited.
      // Keep the completed answer in history rather than erase save evidence.
      if (originalMount && originalView && operation.capture.dto.task === 'outline' && owner.editor?.session === noteEditorSession.current && owner.editor.revision === noteEditorRevision.current && !noteSavePending.current && canRetryNoteWrite(noteProblemRef.current)) {
        const outline = completion.turn
        noteEditorSession.current++
        setBaseRevision(null); resetNoteReview()
        setNoteTitle(t('workbench.outline')); setNoteContent(outline.answer!); setNoteScope(outline.scope_snapshot)
        setEditingNote({ id: '', title: '', content: '', citations: outline.citations, scope_snapshot: outline.scope_snapshot })
        setStudioOpen(false); setTab('notes')
      }
      recovery.releaseCompleted(completion.token)
    } else if (!originalMount) {
      // A prior consumer may have established completion and left before it
      // could consume the answer. Never apply that old answer to a new editor.
      recovery.releaseCompleted(operation.token)
    }
  }, [recovery, mountId, t, currentRequestGeneration])
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
    onSettled: () => { noteSavePending.current = false; noteSaveEpoch.current++; setNoteTransitionNotice(null) },
    onError: (error, value) => {
      if (value.editorSession !== undefined && value.editorSession === noteEditorSession.current) { noteProblemRef.current = noteWriteProblem(error); setNoteProblem(noteProblemRef.current) }
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
    noteSaveEpoch.current++
    note.mutate(value)
  }
  const latestTransitionWorkspace = () => queryClient.getQueryData<Workspace>(QUERY_KEYS.workbench(notebookId)) ?? data
  const latestTransitionNote = (noteId?: string) => latestTransitionWorkspace()?.notes.find(saved => saved.id === noteId)
  const noteTransitionTarget = (kind: NoteTransitionKind, noteId?: string) => {
    if (kind === 'edit') return JSON.stringify(latestTransitionNote(noteId) ?? null)
    if (kind === 'new') return JSON.stringify({ notebookId })
    const scope = projectWorkbenchSelection(selectionRef.current)
    const link = latestTransitionWorkspace()?.link
    return JSON.stringify({ notebookId, engine: scope.engine, origin: scope.selection_origin, local: scope.source_version_ids, remote: scope.remote_source_ids, remoteNotebook: link?.remote_notebook_id, connectionId: link?.connection_id, epoch: readTurnContext()?.epoch })
  }
  const blockNoteTransition = () => {
    const reason = noteSavePending.current ? 'workbench.noteTransitionSaving' : !canRetryNoteWrite(noteProblemRef.current) ? 'workbench.noteTransitionReview' : null
    if (reason) { setNoteTransitionNotice(reason); setStudioOpen(false); setTab('notes') }
    return !!reason
  }
  const applyNoteTransition = (intent: NoteTransitionIntent, confirmed = false) => {
    if (blockNoteTransition()) return
    if (intent.notebookId !== notebookId || intent.session !== noteEditorSession.current || intent.revision !== noteEditorRevision.current || intent.saveEpoch !== noteSaveEpoch.current || intent.target !== noteTransitionTarget(intent.kind, intent.noteId)) {
      setNoteTransitionNotice('workbench.noteTransitionExpired')
      return
    }
    if (intent.kind === 'outline') { submitTurn(true); return }
    const saved = intent.kind === 'edit' ? latestTransitionNote(intent.noteId) : null
    if (intent.kind === 'edit' && (!saved || !Number.isInteger(saved.revision))) { setNoteTransitionNotice('workbench.noteTransitionExpired'); return }
    noteEditorSession.current++
    setBaseRevision(saved?.revision ?? null); resetNoteReview(); setEditingNote(saved ?? null)
    setNoteTitle(saved?.title ?? ''); setNoteContent(saved?.content ?? ''); setNoteScope(saved?.scope_snapshot)
    transitionFocus.current = confirmed
    setStudioOpen(false); setTab('notes'); setFocusNoteEditor(true)
  }
  const requestNoteTransition = (kind: NoteTransitionKind, opener: HTMLButtonElement, saved?: WorkbenchNote) => {
    if (blockNoteTransition()) return
    setNoteTransitionNotice(null)
    transitionFocus.current = false
    const intent: NoteTransitionIntent = { kind, notebookId, session: noteEditorSession.current, revision: noteEditorRevision.current, saveEpoch: noteSaveEpoch.current, target: kind === 'edit' ? JSON.stringify(saved ?? null) : noteTransitionTarget(kind), ...(saved ? { noteId: saved.id } : {}) }
    // Compare with this editor's acknowledged base, never a refreshed list item.
    // Empty native titles use the same fallback as the explicit Save payload.
    const dirty = editingNote?.id ? noteContent !== (editingNote.content ?? '') || (noteTitle || t('common.note')) !== (editingNote.title || t('common.note')) : noteTitle !== '' || noteContent !== '' || !!editingNote
    if (!dirty) { applyNoteTransition(intent); return }
    noteTransitionOpener.current = opener
    noteTransitionRef.current = intent
    setNoteTransition(intent)
  }
  const closeNoteTransition = () => { noteTransitionRef.current = null; setNoteTransition(null) }
  const confirmNoteTransition = () => {
    // Consume synchronously: a second confirm cannot repeat a transition or POST.
    const intent = noteTransitionRef.current
    closeNoteTransition()
    if (intent) applyNoteTransition(intent, true)
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
    setEditingNote(latest); setBaseRevision(latest.revision); setNoteTitle(latest.title ?? ''); setNoteContent(latest.content ?? ''); setNoteScope(latest.scope_snapshot); resetNoteReview()
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
      } catch {
        // Errors belong to the same admitted reading intent as successful locators.
        if (request === citationRequest.current && saveSelection.ownsIntent()) {
          toast({ title: t('workbench.quoteMismatch'), variant: 'destructive' })
        }
      }
    }
  }
  const saveAnswer = (turn: TurnRecord) => submitNote({ answerTurnId: turn.turn_id, title: turn.message, content: turn.answer || '', citations: turn.citations || [], scope_snapshot: turn.scope_snapshot })
  if (workspace.isLoading) return <p className="p-6" role="status">{t('common.loading')}</p>
  if (!data) return <div data-workbench-controls className="p-6 space-y-3"><p role="alert">{requestError(workspace.error) || t('workbench.serviceError')}</p><Button className="min-w-11 [@media(max-width:640px)]:min-h-11 [@media(pointer:coarse)]:min-h-11" disabled={workspace.isFetching} onClick={retryWorkspaceRead}>{t('workbench.retry')}</Button></div>
  const readVersion = citation?.kind === 'remote_unmapped' ? undefined : selection.reading?.source_version_id
  const hasRemoteContext = Boolean(data.link?.remote_notebook_id) || (selection.selection_origin === 'remote' && selection.remote_source_ids.length > 0)
  const unmappedSources = recovery.unmappedSources
  const hasUnsavedNote = (saved: WorkbenchNote) => editingNote?.id === saved.id && (note.isPending || !!noteProblem || baseRevision !== saved.revision || noteContent !== (saved.content || '') || (noteTitle || t('common.note')) !== (saved.title || t('common.note')))
  return <div data-workbench-controls aria-label={t('learningWorkspace.workspace')} className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
    <header className="shrink-0 border-b bg-card px-4 py-3 lg:px-6 space-y-3">
      {workspace.isRefetchError && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><p role="alert">{t('workbench.workspaceRefreshFailed')}</p><Button type="button" size="sm" variant="outline" className="min-w-11 [@media(max-width:640px)]:min-h-11 [@media(pointer:coarse)]:min-h-11" disabled={workspace.isFetching} onClick={retryWorkspaceRead}>{t('workbench.retryWorkspaceRead')}</Button></div>}
      {saveSelection.status !== 'idle' && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <div role="status" aria-live="polite">
          {saveSelection.unconfirmed && <p>{t(saveSelection.notDispatched ? 'workbench.selectionNotSent' : 'workbench.selectionUnconfirmed')}</p>}
          {saveSelection.status === 'saving' && <p>{t('workbench.selectionSaving')}</p>}
          {saveSelection.status === 'saved' && <p>{t('workbench.selectionSaved')}</p>}
          {saveSelection.unconfirmed && !selection.supported && <p>{t('workbench.selectionUnsupported')}</p>}
          {saveSelection.unconfirmed && !saveSelection.ready && <p>{t('workbench.selectionConnectionRequired')}</p>}
        </div>
        {saveSelection.unconfirmed && <Button type="button" size="sm" variant="outline" className="min-w-11 [@media(max-width:640px)]:min-h-11 [@media(pointer:coarse)]:min-h-11" disabled={!saveSelection.canRetry} onClick={saveSelection.retry}>{t('workbench.retrySelectionSave')}</Button>}
      </div>}

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
        return <Button key={name} id={`workbench-tab-${name}`} role="tab" aria-controls={`workbench-panel-${name}`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} variant={tab === name ? 'secondary' : 'ghost'} size="sm" className="workbench-region-tab min-w-0 gap-1 text-xs" onClick={() => setTab(name)} onKeyDown={event => {
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
      <aside id="workbench-panel-sources" aria-label={t('workbench.sources')} className={cn('workbench-side-pane min-w-0 min-h-0 overflow-auto border-r bg-card px-4 pb-5 space-y-3 w-full xl:block xl:w-72 xl:min-w-56 xl:shrink-0 xl:resize-x', tab !== 'sources' && 'hidden')}>
        <h2 className="sticky top-0 z-10 flex items-center gap-2 border-b bg-card py-4 text-sm font-semibold"><Files className="size-4 text-muted-foreground" aria-hidden="true" />{t('workbench.sources')}<span className="ml-auto font-normal text-muted-foreground tabular-nums">{data.sources.length}</span></h2>
        <div className="workbench-import-actions">
          <label className="relative flex min-w-0 cursor-pointer items-center justify-center gap-2 rounded-md border border-primary/30 bg-card px-2 py-2 text-xs font-medium text-primary focus-within:ring-2 focus-within:ring-ring"><Upload className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{t('workbench.upload')}</span><input ref={uploadInput} className="sr-only" type="file" accept=".pdf,.md,.markdown,.txt" multiple onChange={event => { void upload(event.target.files); event.target.value = '' }} /></label>
          <Button className="h-auto min-h-9 min-w-0 gap-2 whitespace-normal px-2 text-xs" variant="outline" ref={discoveryOpener} onClick={() => setDiscoverOpen(true)}><Globe2 className="size-4" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{t('learningWorkspace.discover')}</span></Button>
        </div>
        {uploads.map(item => <div key={item.id} className="space-y-1 text-xs">
          <p className="break-all" role="status">{item.name}: {t({ uploading: 'workbench.uploading', uploadAccepted: 'workbench.uploadAccepted', uploadFailed: 'workbench.uploadFailed', uploadUncertain: 'workbench.uploadUncertain', uploadBlocked: 'workbench.uploadBlocked' }[item.state])}{item.error && ` · ${item.error}`}</p>
          {item.state === 'uploadBlocked' ? <>
            <p className="text-muted-foreground">{t('workbench.uploadBlockedHint')}</p>
            <Button size="sm" variant="outline" disabled={workspace.isFetching} onClick={() => { void workspace.refetch({ cancelRefetch: false }) }}>{t('workbench.inspectUploadSources')}</Button>
            {workspace.isRefetchError && <p role="alert">{t('workbench.uploadInspectionFailed')}</p>}
          </> : item.state !== 'uploading' && <div className="flex flex-wrap gap-2">
            {item.state !== 'uploadAccepted' && <Button size="sm" variant="outline" onClick={() => { void retryUpload(item.id) }}>{t('workbench.retryUpload')}</Button>}
            <Button size="sm" variant="ghost" onClick={() => dismissUpload(item.id)}>{t('workbench.dismissUpload')}</Button>
          </div>}
          {item.state === 'uploadUncertain' && <p className="text-muted-foreground">{t('workbench.uploadRecoveryHint')}</p>}
        </div>)}
        <p className="text-xs leading-5 text-muted-foreground">{t('workbench.readingScopeHint')}</p>
        {selection.selection_origin === 'remote' && <div className="space-y-2"><p className="text-xs leading-5 text-muted-foreground">{t('workbench.remoteLocalSelectionHint')}</p><Button size="sm" variant="outline" onClick={openSettings}>{t('workbench.remoteScope')}</Button></div>}
        <div role="group" aria-label={t('learningWorkspace.sourcesHint')} className="flex flex-wrap gap-1"><Button size="sm" variant="ghost" onClick={() => updateSelection({ source_version_ids: data.sources.flatMap(source => newestSelectableVersionId(source.versions.map(projectWorkbenchVersion)) ?? []) })}>{t('workbench.selectAll')}</Button><Button size="sm" variant="ghost" onClick={() => updateSelection({ source_version_ids: [], remote_source_ids: [] })}>{t('workbench.clearSelection')}</Button></div>
        {localRetrieval && <SemanticIndexPanel notebookId={notebookId} sourceVersionIds={selection.source_version_ids} profileId={retrieval.profileId} retrievalMode={retrieval.mode} readRequestScope={() => ({ sourceVersionIds: projectWorkbenchSelection(selectionRef.current).selection_origin === 'local' ? projectWorkbenchSelection(selectionRef.current).source_version_ids : [], profileId: retrieval.readChoice().profileId, retrievalMode: retrieval.readChoice().mode })} onProfileChange={id => { questionRevision.current++; retrieval.setProfile(id); search.retrievalChanged(retrieval.readOptions(), retrieval.readGeneration) }} />}
        {localRetrieval && <fieldset className="space-y-2 text-xs"><legend>{t('workbench.retrievalMode')}</legend><label className="flex gap-2"><input type="radio" name="retrieval-mode" checked={retrieval.mode === 'lexical'} onChange={() => { questionRevision.current++; retrieval.setMode('lexical'); search.retrievalChanged(retrieval.readOptions(), retrieval.readGeneration) }} />{t('workbench.lexicalOnly')}</label><label className="flex gap-2"><input type="radio" name="retrieval-mode" checked={retrieval.mode === 'hybrid'} onChange={() => { questionRevision.current++; retrieval.setMode('hybrid'); search.retrievalChanged(retrieval.readOptions(), retrieval.readGeneration) }} />{t('workbench.hybridMode')}</label>
          {retrieval.mode === 'hybrid' && <><p>{t('workbench.documentQuerySeparate')}</p><EmbeddingIdentity disclosure={retrieval.disclosure} />{retrieval.disclosure && <p className="break-all">{retrieval.disclosure.endpoint} · {t(embeddingDestinationKeys[retrieval.disclosure.destination_kind] ?? embeddingDestinationKeys.unknown)} · {retrieval.disclosure.destination_descriptor_version}</p>}<label className="flex gap-2"><input type="checkbox" checked={retrieval.queryAcknowledged} disabled={!retrieval.disclosure} onChange={event => { questionRevision.current++; retrieval.acknowledge(event.target.checked); search.retrievalChanged(retrieval.readOptions(), retrieval.readGeneration) }} />{t('workbench.ackQueryProcessing')}</label>{!retrieval.available && <p role="status">{t('workbench.hybridQueryUnavailable')}</p>}</>}
        </fieldset>}
        <div role="search" aria-label={t('workbench.searchSelectedSources')} className="space-y-2">
          <label htmlFor="workspace-search" className="sr-only">{t('learningWorkspace.sourceSearch')}</label>
          <div className="flex items-center gap-2"><Input id="workspace-search" placeholder={t('learningWorkspace.sourceSearch')} className="min-w-0" value={search.query} onChange={event => search.setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!event.nativeEvent.isComposing && event.keyCode !== 229) search.submit() } }} /><Button type="button" size="sm" variant="outline" disabled={!search.canSubmit} onClick={search.submit}>{t('workbench.search')}</Button></div>
          <SelectedSourceReadiness blockers={search.sourceBlockers} />
          <p role={search.status === 'error' ? 'alert' : 'status'} className="text-xs leading-5 text-muted-foreground">{t(!search.scopeAvailable ? 'workbench.searchSelectLocal' : !search.ready ? 'workbench.searchUnavailable' : search.status === 'loading' ? 'workbench.searchLoading' : search.status === 'error' ? 'workbench.searchFailed' : search.status === 'empty' ? 'workbench.searchNoResults' : search.status === 'obsolete' ? 'workbench.searchChanged' : search.status === 'success' ? 'workbench.searchResults' : 'workbench.searchPrompt')}</p>
        {search.metadata && <><p className="text-xs text-muted-foreground">{t('workbench.effectiveRetrieval', { method: t(search.metadata.retrieval_method === 'hybrid' ? 'workbench.hybridMode' : 'workbench.lexicalOnly') })}</p>{search.metadata.retrieval_method === 'lexical_fallback' && <p className="text-xs text-muted-foreground">{t('workbench.retrievalFallback', { reason: search.metadata.fallback_reason ?? t('workbench.unavailable') })}</p>}{search.metadata.selected_version_count !== undefined && <p className="text-xs text-muted-foreground">{t('workbench.retrievalCoverage', { indexed: search.metadata.indexed_version_count ?? 0, selected: search.metadata.selected_version_count })}</p>}{search.status === 'empty' && <p className="text-xs text-muted-foreground">{t('workbench.noSupportingExcerpts')}</p>}{search.metadata.warnings?.map((warning, index) => <p className="text-xs text-muted-foreground" key={index}>{warning}</p>)}</>}
        </div>
        {search.hits.map(hit => <WorkbenchSearchResult key={hit.evidence_id} hit={hit} versionLabel={versionPrefix(hit.source_version_id, displayedVersionIds)} onOpen={hit => { if (search.isCurrent()) openCitation({ citation_id: hit.evidence_id, evidence_id: hit.evidence_id, source_version_id: hit.source_version_id, source_title: hit.source_title || hit.source_version_id, kind: hit.evidence_kind === 'derived_snapshot' ? 'derived_snapshot' : hit.evidence_kind === 'remote_text_snapshot' ? 'remote_text_snapshot' : 'local_evidence', provenance: hit.provenance, independent_support: hit.independent_support, locator: hit.locator, quote: hit.quote, reference_validity: hit.reference_validity || 'unverified' }) }} />)}
        {!data.sources.length && <p className="text-sm text-muted-foreground">{t('workbench.noSources')}</p>}
        <WorkbenchSourcesList notebookId={notebookId} sources={data.sources} selectedVersionIds={selection.source_version_ids} displayedVersionIds={displayedVersionIds} onSelectionChange={ids => updateSelection({ source_version_ids: ids })} onRead={id => { citationRequest.current++; setCitation(null); setReaderOpen(true); setTab('conversation'); focusReader(); updateSelection({ reading: { source_version_id: id, page_index: 0 } }) }} onUpload={(files, id) => { void upload(files, id) }} />
      </aside>
      <div id="workbench-panel-conversation" className={cn('min-w-0 min-h-0 overflow-auto flex-1 px-4 pb-6 space-y-5 lg:px-6 xl:block', tab !== 'conversation' && 'hidden')}>
        <div className="sticky top-0 z-10 flex gap-2 border-b bg-background py-3"><Button ref={readerButton} size="sm" aria-pressed={readerOpen} variant={readerOpen ? 'secondary' : 'ghost'} onClick={() => setReaderOpen(true)}><BookOpen className="size-4" aria-hidden="true" />{t('workbench.reader')}</Button><Button size="sm" aria-pressed={!readerOpen} variant={!readerOpen ? 'secondary' : 'ghost'} onClick={() => setReaderOpen(false)}><MessageSquare className="size-4" aria-hidden="true" />{t('workbench.conversation')}</Button></div>
        {!data.sources.length && !hasRemoteContext && !readVersion && !citation && <div className="space-y-2 py-2">
          <h2 className="text-base font-semibold">{t('workbench.startLocalTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('workbench.localToolsHint')}</p>
          <Button size="sm" onClick={() => { setTab('sources'); setFocusUpload(true) }}><Upload className="size-4" aria-hidden="true" />{t('workbench.addStudyMaterials')}</Button>
        </div>}
        {(data.sources.length > 0 || readVersion || citation) && <div className={cn(!readerOpen && 'hidden')}><EvidenceReader sourceVersionId={readVersion} evidenceId={selection.reading?.evidence_id} citation={citation} initialPage={selection.reading?.page_index || 0} onPositionChange={changeReadingPosition} onChanged={refresh} /></div>}
        <section className={cn("space-y-4", readerOpen && "hidden")} aria-label={t('workbench.conversation')}>
          <div className="rounded-lg border bg-card p-4 space-y-3"><div role="group" aria-label={t('workbench.askScope')} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><Layers className="size-3.5" aria-hidden="true" /><span>{t(knownEngine ? selection.engine === 'independent' ? 'workbench.independent' : 'workbench.notebooklm' : 'workbench.unknownEngine')}</span><span aria-hidden="true">·</span><span>{t(knownOrigin ? selection.selection_origin === 'local' ? 'workbench.localScope' : 'workbench.remoteScope' : 'workbench.unknownScope')}</span><span aria-hidden="true">·</span><span>{t('workbench.selectedCount', { count: selectedCount })}</span><Button type="button" size="sm" variant="ghost" onClick={openSettings}>{t('workbench.changeScope')}</Button></div><label className="block text-sm font-semibold" htmlFor="workbench-question">{t('workbench.question')}</label><Textarea id="workbench-question" value={question} onChange={event => { questionRevision.current++; setQuestion(event.target.value) }} rows={3} />
          <SelectedSourceReadiness blockers={sourceBlockers} />
          {showModelStatus && <div className="space-y-2">
            <p id="workbench-model-status" role={modelState === 'error' ? 'alert' : 'status'} className="text-xs text-muted-foreground">{t(modelStatusKey)}</p>
            {modelState === 'error' && <Button size="sm" variant="outline" onClick={() => { void modelDefaults.refetch() }}>{t('workbench.retryModelCheck')}</Button>}
            {modelState === 'notConfigured' && <Button size="sm" variant="ghost" onClick={openSettings}>{t('workbench.modelSettings')}</Button>}
          </div>}
          {selection.supported && knownOrigin && selectedCount === 0 && <p className="text-xs text-muted-foreground">{t('workbench.emptySelection')}</p>}
          {!selection.supported && knownEngine && knownOrigin && <p role="status" className="text-xs text-muted-foreground">{t('workbench.scope')}: {t('workbench.unavailable')}</p>}
          {!knownEngine && <p role="status" className="text-xs text-muted-foreground">{t('workbench.engine')}: {typeof selection.engine === 'string' ? selection.engine : ''} — {t('workbench.unavailable')}</p>}
          {!knownOrigin && <p role="status" className="text-xs text-muted-foreground">{t('workbench.scope')}: {typeof selection.selection_origin === 'string' ? selection.selection_origin : ''} — {t('workbench.unavailable')}</p>}
          {selection.supported && knownEngine && selectedCount > 0 && !canAsk && !modelBlocked && sourceBlockers.length === 0 && <p className="text-xs text-muted-foreground">{googleBlocked || t(selection.engine === 'independent' && selection.selection_origin === 'remote' ? 'workbench.independentLocalOnly' : 'workbench.emptySelection')}</p>}
          {selectedCount > 0 && googleBlocked && <Button size="sm" variant="outline" onClick={openSettings}>{t('navigation.settings')}</Button>}
          {mountId === null && <p role="status" className="text-xs text-muted-foreground">{t('workbench.unavailable')}</p>}
          <div className="flex flex-wrap gap-2"><Button aria-describedby={showModelStatus ? 'workbench-model-status' : undefined} disabled={mountId === null || !canAsk || (localRetrieval && !retrieval.available) || !question.trim() || !recovery.ready || !!recovery.operation} onClick={() => submitTurn(false)}>{t('workbench.ask')}</Button><Button aria-describedby={showModelStatus ? 'workbench-model-status' : undefined} variant="outline" disabled={mountId === null || !canAsk || (localRetrieval && retrieval.mode === 'hybrid') || !recovery.ready || !!recovery.operation} onClick={event => requestNoteTransition('outline', event.currentTarget)}>{t('workbench.outline')}</Button></div></div>
          {localRetrieval && retrieval.mode === 'hybrid' && <p className="text-xs text-muted-foreground">{t('workbench.hybridOutlineUnavailable')}</p>}
          {recovery.submissionFailed && <p role="alert" className="text-destructive">{t('workbench.answerFailure')}</p>}
          {unmappedSources && <div role="alert" className="space-y-2"><p className="text-sm leading-6 text-muted-foreground">{t('learningWorkspace.unmappedSources')}</p><Button size="sm" variant="outline" onClick={openSettings}>{t('navigation.settings')}</Button></div>}
          <TurnRecoveryPanel recovery={recovery} />
          {uncertainAnswer && <div className="space-y-3" data-answer-turn={uncertainAnswer.turnId}>
            <h3 className="font-medium break-words">{uncertainAnswer.snapshot.title}</h3>
            <NoteConflictPanel problem={uncertainAnswer.problem} baseRevision={null} draft={uncertainAnswer.snapshot} latest={answerLatest ? [answerLatest] : null} loading={answerComparing} readFailed={answerReadFailed} onCompare={compareAnswer} />
            {answerCandidates && <section className="space-y-2" aria-label={t('noteConflict.candidates')}><h3 className="text-sm font-medium">{t('noteConflict.candidates')}</h3>{answerCandidates.length ? answerCandidates.map(candidate => <Button key={candidate.id} type="button" variant="outline" size="sm" className="block max-w-full truncate" disabled={answerComparing} aria-label={`${t('noteConflict.inspectCandidate')}: ${candidate.title || t('sources.untitledNote')}`} onClick={() => setAnswerLatest(candidate)}>{candidate.title || t('sources.untitledNote')}</Button>) : <p className="text-sm text-muted-foreground">{t('noteConflict.notFound')}</p>}</section>}
          </div>}
          {!turns.length && <div className="space-y-2 py-6"><h2 className="text-base font-medium">{t(selectedCount ? 'workbench.conversation' : 'learningWorkspace.selectSources')}</h2><p className="max-w-prose text-sm leading-6 text-muted-foreground">{t('learningWorkspace.chatEmpty')}</p></div>}
          {!!turns.length && <h2 className="text-sm font-semibold text-muted-foreground">{t('workbench.history')}</h2>}
          {data.legacy_history?.map(session => <details className="rounded-md border p-3 space-y-2" key={session.chat_session_id}><summary className="text-sm">{t('workbench.importedHistory')}</summary>{session.messages?.map((message, index) => <div key={index} className="border-t py-2 text-sm"><p className="text-xs text-muted-foreground">{message.role}</p>{typeof message.content === 'string' && <MarkdownRenderer>{message.content}</MarkdownRenderer>}</div>)}</details>)}
          {turns.map(turn => <article className="min-w-0 rounded-md border p-4 space-y-3 [overflow-wrap:anywhere]" key={turn.turn_id}><h3 className="min-w-0 font-medium [overflow-wrap:anywhere]">{turn.message}</h3><details className="text-xs text-muted-foreground"><summary>{t('workbench.turnScope')} · {isKnownEngine(turn.engine) ? t(turn.engine === 'independent' ? 'workbench.independent' : 'workbench.notebooklm') : typeof turn.engine === 'string' ? turn.engine : t('workbench.unavailable')}</summary><p className="break-all">{[...(turn.scope_snapshot?.source_version_ids || []), ...(turn.scope_snapshot?.remote_source_ids || [])].join(', ')}</p></details><TurnCoverage coverage={turn.coverage} warnings={turn.warnings} retrieval={turn.retrieval} />{turn.answer && <MarkdownRenderer>{turn.answer}</MarkdownRenderer>}{!turn.answer && <p className="text-sm">{t(stateKeys[turn.state || turn.status || 'pending'] || 'workbench.unavailable')}</p>}{!!turn.error && <p className="text-xs text-destructive">{typeof turn.error === 'string' ? turn.error : (turn.error as { message?: string; code?: string }).message || (turn.error as { code?: string }).code || t('workbench.error')}</p>}{turn.state === 'submission_unknown' && <p className="text-sm text-muted-foreground">{t('workbench.unknownSubmission')}</p>}<div className="flex flex-wrap gap-2">{turn.citations?.map(reference => <WorkbenchCitationButton key={reference.citation_id} citation={reference} onOpen={openCitation} />)}</div>{turn.answer && <Button size="sm" variant="outline" disabled={note.isPending || !!uncertainAnswer} onClick={() => saveAnswer(turn)}>{t('workbench.saveAnswer')}</Button>}{turn.answer && (!turn.state || turn.state === 'succeeded') && (!turn.status || turn.status === 'succeeded') && <SnapshotPromotionButton notebookId={notebookId} origin={{ kind: 'turn', id: turn.turn_id }} onAdded={refresh} />}</article>)}
        </section>
      </div>
      <aside id="workbench-panel-notes" aria-label={t('workbench.notes')} className={cn('workbench-side-pane min-w-0 min-h-0 overflow-auto border-l bg-card px-4 pb-5 space-y-4 w-full xl:block xl:w-72 2xl:w-80 xl:min-w-56 xl:shrink-0 xl:resize-x', tab !== 'notes' && 'hidden')}>
        <div className="sticky top-0 z-10 flex flex-wrap justify-between items-center gap-2 border-b bg-card py-3"><div className="flex gap-1"><Button size="sm" variant={studioOpen ? 'ghost' : 'secondary'} aria-pressed={!studioOpen} onClick={() => setStudioOpen(false)}>{t('learningWorkspace.notesTab')}</Button><Button size="sm" variant={studioOpen ? 'secondary' : 'ghost'} aria-pressed={studioOpen} onClick={() => setStudioOpen(true)}>{t('learningWorkspace.studioTab')}</Button></div><Button size="sm" variant="ghost" onClick={event => requestNoteTransition('new', event.currentTarget)}>{t('common.new')}</Button></div>
        {noteTransitionNotice && <p role="status" className="text-sm text-muted-foreground">{t(noteTransitionNotice)}</p>}
        <div className={cn("space-y-4", studioOpen && "hidden")}><label className="text-xs block" htmlFor="note-title">{t('workbench.noteTitle')}</label><Input ref={noteTitleInput} id="note-title" value={noteTitle} onChange={event => { noteEditorRevision.current++; setNoteTitle(event.target.value) }} />
        <label className="text-xs block" htmlFor="note-content">{t('workbench.noteContent')}</label><Textarea id="note-content" className="bg-background leading-6" rows={8} value={noteContent} onChange={event => { noteEditorRevision.current++; setNoteContent(event.target.value) }} />
        <Button size="sm" disabled={!noteContent.trim() || note.isPending || !canRetryNoteWrite(noteProblem) || (!!editingNote?.id && baseRevision == null)} onClick={() => submitNote({ editorSession: noteEditorSession.current, baseRevision, noteId: editingNote?.id || undefined, title: noteTitle || t('common.note'), content: noteContent, citations: editingNote?.citations || [], scope_snapshot: noteScope || currentNoteScope })}>{t('workbench.saveNote')}</Button>
        {noteProblem && <NoteConflictPanel problem={noteProblem} baseRevision={baseRevision} draft={{ title: noteTitle, content: noteContent, citations: editingNote?.citations, scope_snapshot: noteScope }} latest={latestNotes} loading={comparing} readFailed={compareFailed} onCompare={compareNote} onReload={editingNote?.id ? reloadNote : undefined} />}
        {!data.notes.length && <p className="text-sm text-muted-foreground">{t('learningWorkspace.notesEmpty')}</p>}
        {data.notes.map(saved => <article key={saved.id} className="min-w-0 rounded-md border p-3 space-y-2 [overflow-wrap:anywhere]"><h3 className="min-w-0 font-medium [overflow-wrap:anywhere]">{saved.title}</h3><MarkdownRenderer>{saved.content || ''}</MarkdownRenderer>{!!saved.citations?.length && <div className="flex flex-wrap gap-2">{saved.citations.map(reference => <WorkbenchCitationButton key={reference.citation_id} citation={reference} onOpen={openCitation} />)}</div>}{Number.isInteger(saved.revision) && <Button size="sm" variant="outline" onClick={event => requestNoteTransition('edit', event.currentTarget, saved)}>{t('common.edit')}</Button>}{Number.isInteger(saved.revision) && <fieldset disabled={hasUnsavedNote(saved)}><SnapshotPromotionButton notebookId={notebookId} origin={{ kind: 'note', id: saved.id, revision: saved.revision }} onAdded={refresh} /></fieldset>}{hasUnsavedNote(saved) && <p className="text-xs text-muted-foreground">{t('sourceSnapshots.saveFirst')}</p>}</article>)}
        </div><div className={cn("space-y-4", !studioOpen && "hidden")}><p className="text-xs leading-5 text-muted-foreground">{t('learningWorkspace.studioDescription')}</p><JobsPanel jobs={data.jobs || []} onChanged={refresh} turnFence={recovery.operation ? { key: recovery.operation.capture.dto.idempotency_key, parentJobId: recovery.operation.receipt?.jobId, turnId: recovery.operation.receipt?.turnId } : undefined} /></div>
      </aside>
    </div>
    <NoteDraftTransitionDialog kind={noteTransition?.kind ?? null} onCancel={closeNoteTransition} onConfirm={confirmNoteTransition} onCloseAutoFocus={event => {
      event.preventDefault()
      // Presence can retain the closing dialog across animation frames. Consume
      // the confirmed destination only at the real FocusScope unmount callback.
      if (transitionFocus.current) { transitionFocus.current = false; noteTitleInput.current?.focus() }
      else noteTransitionOpener.current?.focus()
    }} />
    <WebDiscoveryDialog key={notebookId} onCloseAutoFocus={event => { event.preventDefault(); discoveryOpener.current?.focus() }} notebookId={notebookId} open={discoverOpen} onOpenChange={setDiscoverOpen} onImported={refresh} />
    <NotebookSettingsDialog notebookId={notebookId} open={settingsOpen} onOpenChange={setSettingsOpen} onCloseAutoFocus={event => { event.preventDefault(); settingsOpener.current?.focus() }} selection={selection} onSelectionChange={updateSelection} link={data.link} onChanged={refresh} modelStatus={modelStatusKey} connectionStatus={connectionStatusKey} />
  </div>
}
