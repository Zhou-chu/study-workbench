'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import { useTranslation } from '@/lib/hooks/use-translation'
import { chatApi } from '@/lib/api/chat'
import { QUERY_KEYS } from '@/lib/api/query-client'
import {
  NotebookChatMessage,
  NotebookChatSession,
  UpdateNotebookChatSessionRequest,
  SourceListResponse,
  NoteResponse
} from '@/lib/types/api'
import { ContextSelections } from '@/app/(dashboard)/notebooks/[id]/page'

interface Ownership {
  notebook: string
  generation: number
}

interface UseNotebookChatParams {
  notebookId: string
  sources: SourceListResponse[]
  notes: NoteResponse[]
  contextSelections: ContextSelections
}

export function useNotebookChat({ notebookId, sources, notes, contextSelections }: UseNotebookChatParams) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selection, setSelection] = useState<{ notebook: string, id: string | null }>({ notebook: notebookId, id: null })
  const currentSessionId = selection.notebook === notebookId ? selection.id : null
  const notebookRef = useRef(notebookId)
  const selectedRef = useRef<string | null>(null)
  const generationRef = useRef(0)
  const mountedRef = useRef(true)
  const operationRef = useRef<object | null>(null)
  const hydrateRef = useRef(true)
  const [messages, setMessages] = useState<NotebookChatMessage[]>([])
  const [isSending, setIsSending] = useState(false)
  const [tokenCount, setTokenCount] = useState<number>(0)
  const [charCount, setCharCount] = useState<number>(0)
  // Pending model override for when user changes model before a session exists
  const [pendingModelOverride, setPendingModelOverride] = useState<string | null>(null)

  // Requests are not remotely canceled: invalidate only their ownership of UI state.
  const invalidateOperation = useCallback(() => {
    generationRef.current += 1
    operationRef.current = null
    setIsSending(false)
  }, [])
  const selectSession = useCallback((id: string | null) => {
    selectedRef.current = id
    hydrateRef.current = true
    setSelection({ notebook: notebookId, id })
    setMessages([])
  }, [notebookId])
  const owns = useCallback(({ notebook, generation }: Ownership) =>
    mountedRef.current && notebookRef.current === notebook && generationRef.current === generation, [])

  useEffect(() => {
    mountedRef.current = true
    if (notebookRef.current !== notebookId) {
      notebookRef.current = notebookId
      selectSession(null)
      setIsSending(false)
      setPendingModelOverride(null)
      setTokenCount(0)
      setCharCount(0)
    }
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      operationRef.current = null
    }
  }, [notebookId, selectSession])

  // Fetch sessions for this notebook
  const {
    data: sessions = [],
    isLoading: loadingSessions,
    refetch: refetchSessions
  } = useQuery({
    queryKey: QUERY_KEYS.notebookChatSessions(notebookId),
    queryFn: () => chatApi.listSessions(notebookId),
    enabled: !!notebookId
  })

  // Fetch current session with messages
  const {
    data: currentSession
  } = useQuery({
    queryKey: QUERY_KEYS.notebookChatSession(currentSessionId!),
    queryFn: () => chatApi.getSession(currentSessionId!),
    enabled: !!notebookId && !!currentSessionId
  })

  // Update messages when current session changes
  useEffect(() => {
    if (hydrateRef.current && currentSession?.id === currentSessionId && currentSession?.messages) {
      setMessages(currentSession.messages)
    }
  }, [currentSession, currentSessionId, isSending])

  // Auto-select most recent session when sessions are loaded
  useEffect(() => {
    if (sessions.length > 0 && !currentSessionId && !operationRef.current) {
      // Sessions are sorted by created date desc from API
      const mostRecentSession = sessions[0]
      selectSession(mostRecentSession.id)
    }
  }, [sessions, currentSessionId, selectSession])

  // Create session mutation
  const createSessionMutation = useMutation({
    mutationFn: ({ title, notebook }: Ownership & { title?: string }) =>
      chatApi.createSession({ notebook_id: notebook, title }),
    onSuccess: (newSession, owner) => {
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.notebookChatSessions(owner.notebook)
      })
      if (!owns(owner)) return
      selectSession(newSession.id)
      toast.success(t('chat.sessionCreated'))
    },
    onError: (err: unknown, owner) => {
      if (!owns(owner)) return
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToCreateSession'))
    }
  })

  // Update session mutation
  const updateSessionMutation = useMutation({
    mutationFn: ({ sessionId, data }: {
      sessionId: string
      data: UpdateNotebookChatSessionRequest
    } & Ownership) => chatApi.updateSession(sessionId, data),
    onSuccess: (_, owner) => {
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.notebookChatSessions(owner.notebook)
      })
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.notebookChatSession(owner.sessionId)
      })
      if (owns(owner)) toast.success(t('chat.sessionUpdated'))
    },
    onError: (err: unknown, owner) => {
      if (!owns(owner)) return
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToUpdateSession'))
    }
  })

  // Delete session mutation
  const deleteSessionMutation = useMutation({
    mutationFn: ({ sessionId }: Ownership & { sessionId: string }) =>
      chatApi.deleteSession(sessionId),
    onSuccess: (_, owner) => {
      const deletedId = owner.sessionId
      // Reconcile the captured target even if another selection now owns the UI.
      queryClient.removeQueries({ queryKey: QUERY_KEYS.notebookChatSession(deletedId), exact: true })
      queryClient.setQueryData<NotebookChatSession[]>(
        QUERY_KEYS.notebookChatSessions(owner.notebook),
        previous => previous?.filter(session => session.id !== deletedId)
      )
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebookChatSessions(owner.notebook) })
      const showToast = owns(owner)
      if (mountedRef.current && notebookRef.current === owner.notebook && selectedRef.current === deletedId) {
        invalidateOperation()
        selectSession(null)
      }
      if (showToast) toast.success(t('chat.sessionDeleted'))
    },
    onError: (err: unknown, owner) => {
      if (!owns(owner)) return
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToDeleteSession'))
    }
  })

  // Build context from sources and notes based on user selections
  const buildContext = useCallback(async () => {
    // Build context_config mapping IDs to selection modes
    const context_config: { sources: Record<string, string>, notes: Record<string, string> } = {
      sources: {},
      notes: {}
    }

    // Map source selections
    sources.forEach(source => {
      const mode = contextSelections.sources[source.id]
      if (mode === 'insights') {
        context_config.sources[source.id] = 'insights'
      } else if (mode === 'full') {
        context_config.sources[source.id] = 'full content'
      } else {
        context_config.sources[source.id] = 'not in'
      }
    })

    // Map note selections
    notes.forEach(note => {
      const mode = contextSelections.notes[note.id]
      if (mode === 'full') {
        context_config.notes[note.id] = 'full content'
      } else {
        context_config.notes[note.id] = 'not in'
      }
    })

    // Call API to build context with actual content
    const response = await chatApi.buildContext({
      notebook_id: notebookId,
      context_config
    })

    return response
  }, [notebookId, sources, notes, contextSelections])

  // Send message (synchronous, no streaming)
  const sendMessage = useCallback(async (message: string, modelOverride?: string) => {
    if (!mountedRef.current || notebookRef.current !== notebookId || operationRef.current) return
    const operation = {}
    operationRef.current = operation
    const owner = { notebook: notebookId, generation: ++generationRef.current }
    let sessionId = selectedRef.current
    const isCurrent = () => owns(owner) && operationRef.current === operation && selectedRef.current === sessionId
    hydrateRef.current = false
    setIsSending(true)
    const userMessageId = `temp-${owner.generation}-${Date.now()}`
    let receivedResponse = false
    try {
      // Auto-create session if none exists
      if (!sessionId) {
        try {
          const defaultTitle = message.length > 30
            ? `${message.substring(0, 30)}...`
            : message
          const newSession = await chatApi.createSession({
            notebook_id: notebookId,
            title: defaultTitle,
            // Include pending model override when creating session
            model_override: pendingModelOverride ?? undefined
          })
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebookChatSessions(owner.notebook) })
          if (!isCurrent()) return
          sessionId = newSession.id
          selectedRef.current = sessionId
          setSelection({ notebook: notebookId, id: sessionId })
          // Clear pending model override now that it's applied to the session
          setPendingModelOverride(null)

        } catch (err: unknown) {
          if (!isCurrent()) return
          const error = err as { response?: { data?: { detail?: string } }, message?: string };
          toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToCreateSession'))
          return
        }
      }

      // Add user message optimistically
      const userMessage: NotebookChatMessage = {
        id: userMessageId,
        type: 'human',
        content: message,
        timestamp: new Date().toISOString()
      }
      setMessages(prev => [...prev, userMessage])

      // Build context and send message only while this selection still owns admission.
      const built = await buildContext()
      if (!isCurrent()) return
      setTokenCount(built.token_count)
      setCharCount(built.char_count)
      const context = built.context
      const response = await chatApi.sendMessage({
        session_id: sessionId,
        message,
        context,
        model_override: modelOverride ?? (currentSession?.model_override ?? undefined)
      })

      if (!isCurrent()) return
      // Preserve server history semantics, then perform one fresh read of the actual target.
      receivedResponse = true
      setMessages(response.messages)

      // Discard older query results before the authoritative read. chatApi does not
      // accept an AbortSignal, so this cancels cache ownership, not remote HTTP.
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.notebookChatSession(sessionId), exact: true })
      if (!isCurrent()) return
      const refreshed = await chatApi.getSession(sessionId)
      if (!isCurrent()) return
      queryClient.setQueryData(QUERY_KEYS.notebookChatSession(sessionId), refreshed)
      setMessages(refreshed.messages)
      hydrateRef.current = true
    } catch (err: unknown) {
      if (!isCurrent()) return
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      console.error('Error sending message:', error)
      toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToSendMessage'))
      // A failed send must not permanently suppress a pending initial history read.
      if (!receivedResponse) hydrateRef.current = true
      // Remove optimistic message on error
      setMessages(prev => prev.filter(msg => msg.id !== userMessageId))
    } finally {
      if (isCurrent()) {
        operationRef.current = null
        setIsSending(false)
      }
    }
  }, [
    notebookId,
    currentSession,
    pendingModelOverride,
    buildContext,
    owns,
    queryClient,
    t
  ])

  // Switch session
  const switchSession = useCallback((sessionId: string) => {
    if (selectedRef.current === sessionId) return
    invalidateOperation()
    selectSession(sessionId)
  }, [invalidateOperation, selectSession])

  // Create session
  const createSession = useCallback((title?: string) => {
    invalidateOperation()
    return createSessionMutation.mutate({
      notebook: notebookId,
      generation: generationRef.current,
      title
    })
  }, [createSessionMutation, notebookId, invalidateOperation])

  // Update session
  const updateSession = useCallback((sessionId: string, data: UpdateNotebookChatSessionRequest) => {
    return updateSessionMutation.mutate({
      sessionId,
      data,
      notebook: notebookId,
      generation: generationRef.current
    })
  }, [updateSessionMutation, notebookId])

  // Delete session
  const deleteSession = useCallback((sessionId: string) => {
    if (selectedRef.current === sessionId) invalidateOperation()
    return deleteSessionMutation.mutate({ sessionId, notebook: notebookId, generation: generationRef.current })
  }, [deleteSessionMutation, notebookId, invalidateOperation])

  // Set model override - handles both existing sessions and pending state
  const setModelOverride = useCallback((model: string | null) => {
    if (currentSessionId) {
      // Session exists - update it directly
      updateSessionMutation.mutate({
        notebook: notebookId,
        generation: generationRef.current,
        sessionId: currentSessionId,
        data: { model_override: model }
      })
    } else {
      // No session yet - store as pending
      setPendingModelOverride(model)
    }
  }, [currentSessionId, updateSessionMutation, notebookId])

  // Update token/char counts when context selections change
  useEffect(() => {
    let active = true
    const updateContextCounts = async () => {
      try {
        const response = await buildContext()
        if (!active) return
        setTokenCount(response.token_count)
        setCharCount(response.char_count)
      } catch (error) {
        if (active) console.error('Error updating context counts:', error)
      }
    }
    updateContextCounts()
    return () => { active = false }
  }, [buildContext])

  return {
    // State
    sessions,
    currentSession: currentSession || sessions.find(s => s.id === currentSessionId),
    currentSessionId,
    messages,
    isSending,
    loadingSessions,
    tokenCount,
    charCount,
    pendingModelOverride,

    // Actions
    createSession,
    updateSession,
    deleteSession,
    switchSession,
    sendMessage,
    setModelOverride,
    refetchSessions
  }
}
