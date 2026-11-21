'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import { useTranslation } from '@/lib/hooks/use-translation'
import { sourceChatApi } from '@/lib/api/source-chat'
import {
  SourceChatSession,
  SourceChatMessage,
  SourceChatContextIndicator,
  CreateSourceChatSessionRequest,
  UpdateSourceChatSessionRequest
} from '@/lib/types/api'

interface ChatOperation {
  controller: AbortController
  reader?: ReadableStreamDefaultReader<Uint8Array>
}

export function useSourceChat(sourceId: string) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selection, setSelection] = useState<{ sourceId: string, id: string | null }>({ sourceId, id: null })
  // A new source must never fetch the previous source's selected session.
  const currentSessionId = selection.sourceId === sourceId ? selection.id : null
  const [messages, setMessages] = useState<SourceChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [contextIndicators, setContextIndicators] = useState<SourceChatContextIndicator | null>(null)
  const operationRef = useRef<ChatOperation | null>(null)
  const generationRef = useRef(0)
  const mountedRef = useRef(true)
  const sourceRef = useRef(sourceId)
  const selectedSessionRef = useRef<string | null>(null)
  // Once sending starts, only that operation's fresh read may replace local
  // text. An earlier session read must not erase live or canceled partial text.
  const hydrateSessionRef = useRef(true)

  const cancelOperation = useCallback(() => {
    generationRef.current += 1
    const operation = operationRef.current
    operationRef.current = null
    operation?.controller.abort()
    void operation?.reader?.cancel().catch(() => { /* Already aborted/closed. */ })
  }, [])

  const selectSession = useCallback((id: string | null) => {
    selectedSessionRef.current = id
    hydrateSessionRef.current = true
    setSelection({ sourceId, id })
    setMessages([])
    setContextIndicators(null)
  }, [sourceId])

  const cancelStreaming = useCallback(() => {
    cancelOperation()
    setIsStreaming(false)
  }, [cancelOperation])

  const switchSession = useCallback((sessionId: string) => {
    if (selectedSessionRef.current === sessionId) return
    cancelStreaming()
    selectSession(sessionId)
  }, [cancelStreaming, selectSession])

  useEffect(() => {
    mountedRef.current = true
    if (sourceRef.current !== sourceId) {
      sourceRef.current = sourceId
      selectSession(null)
      setIsStreaming(false)
    }
    return () => {
      mountedRef.current = false
      cancelOperation()
    }
  }, [sourceId, selectSession, cancelOperation])

  // Fetch sessions
  const { data: sessions = [], isLoading: loadingSessions, refetch: refetchSessions } = useQuery<SourceChatSession[]>({
    queryKey: ['sourceChatSessions', sourceId],
    queryFn: () => sourceChatApi.listSessions(sourceId),
    enabled: !!sourceId
  })

  // Fetch current session with messages
  const { data: currentSession } = useQuery({
    queryKey: ['sourceChatSession', sourceId, currentSessionId],
    queryFn: () => sourceChatApi.getSession(sourceId, currentSessionId!),
    enabled: !!sourceId && !!currentSessionId
  })

  // Update messages when session changes
  useEffect(() => {
    if (!hydrateSessionRef.current || currentSession?.id !== currentSessionId) return
    if (currentSession?.messages) {
      setMessages(currentSession.messages)
    }
    // Also clears the badge when the session goes away (deleted / switched).
    setContextIndicators(currentSession?.context_indicators ?? null)
  }, [currentSession, currentSessionId])

  // Auto-select most recent session when sessions are loaded
  useEffect(() => {
    if (sessions.length > 0 && !currentSessionId && !operationRef.current) {
      // Find most recent session (sessions are sorted by created date desc from API)
      const mostRecentSession = sessions[0]
      selectSession(mostRecentSession.id)
    }
  }, [sessions, currentSessionId, selectSession])

  // Create session mutation
  const createSessionMutation = useMutation({
    mutationFn: ({ data, source }: { data: Omit<CreateSourceChatSessionRequest, 'source_id'>, source: string, generation: number }) =>
      sourceChatApi.createSession(source, data),
    onSuccess: (newSession, { source, generation }) => {
      if (!mountedRef.current || sourceRef.current !== source || generationRef.current !== generation) return
      queryClient.invalidateQueries({ queryKey: ['sourceChatSessions', source] })
      selectSession(newSession.id)
      toast.success(t('chat.sessionCreated'))
    },
    onError: (err: unknown, { source, generation }) => {
      if (!mountedRef.current || sourceRef.current !== source || generationRef.current !== generation) return
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToCreateSession'))
    }
  })

  // Update session mutation
  const updateSessionMutation = useMutation({
    mutationFn: ({ sessionId, data }: { sessionId: string, data: UpdateSourceChatSessionRequest }) =>
      sourceChatApi.updateSession(sourceId, sessionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sourceChatSessions', sourceId] })
      queryClient.invalidateQueries({ queryKey: ['sourceChatSession', sourceId, currentSessionId] })
      toast.success(t('chat.sessionUpdated'))
    },
    onError: (err: unknown) => {
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToUpdateSession'))
    }
  })

  // Delete session mutation
  const deleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) => 
      sourceChatApi.deleteSession(sourceId, sessionId),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['sourceChatSessions', sourceId] })
      if (currentSessionId === deletedId) {
        cancelStreaming()
        selectSession(null)
      }
      toast.success(t('chat.sessionDeleted'))
    },
    onError: (err: unknown) => {
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToDeleteSession'))
    }
  })

  // Send message with streaming. Admission is synchronous, before any await:
  // a second click cannot create a second session or dispatch another message.
  const sendMessage = useCallback(async (message: string, modelOverride?: string) => {
    if (!mountedRef.current || sourceRef.current !== sourceId || operationRef.current) return
    const operation: ChatOperation = { controller: new AbortController() }
    operationRef.current = operation
    const generation = ++generationRef.current
    const isCurrent = () => mountedRef.current && sourceRef.current === sourceId &&
      generationRef.current === generation && !operation.controller.signal.aborted
    hydrateSessionRef.current = false
    setIsStreaming(true)
    let sessionId = selectedSessionRef.current
    let userMessageId: string | undefined

    try {
      if (!sessionId) {
        try {
          const defaultTitle = message.length > 30 ? `${message.substring(0, 30)}...` : message
          const newSession = await sourceChatApi.createSession(sourceId, { title: defaultTitle })
          if (!isCurrent()) return
          sessionId = newSession.id
          selectedSessionRef.current = sessionId
          setSelection({ sourceId, id: sessionId })
          queryClient.invalidateQueries({ queryKey: ['sourceChatSessions', sourceId] })
        } catch (err: unknown) {
          if (!isCurrent()) return
          const error = err as { response?: { data?: { detail?: string } }, message?: string };
          console.error('Failed to create chat session:', error)
          toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToCreateSession'))
          return
        }
      }

      userMessageId = `temp-${generation}-${Date.now()}`
      const userMessage: SourceChatMessage = {
        id: userMessageId,
        type: 'human',
        content: message,
        timestamp: new Date().toISOString()
      }
      setMessages(prev => [...prev, userMessage])

      const response = await sourceChatApi.sendMessage(sourceId, sessionId, {
        message,
        model_override: modelOverride
      }, operation.controller.signal)
      if (!isCurrent()) {
        void response?.cancel().catch(() => { /* Late body already closed. */ })
        return
      }
      if (!response) throw new Error('No response body')

      const reader = response.getReader()
      operation.reader = reader
      const decoder = new TextDecoder()
      let aiMessage: SourceChatMessage | null = null
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (!isCurrent() || done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')

        // Keep the last incomplete line in buffer
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6).trim()
              if (!jsonStr) continue

              const data = JSON.parse(jsonStr)
              
              if (data.type === 'ai_message') {
                // Create AI message on first content chunk to avoid empty bubble
                if (!aiMessage) {
                  aiMessage = {
                    id: `ai-${generation}-${Date.now()}`,
                    type: 'ai',
                    content: data.content || '',
                    timestamp: new Date().toISOString()
                  }
                  setMessages(prev => [...prev, aiMessage!])
                } else {
                  aiMessage.content += data.content || ''
                  setMessages(prev =>
                    prev.map(msg => msg.id === aiMessage!.id
                      ? { ...msg, content: aiMessage!.content }
                      : msg
                    )
                  )
                }
              } else if (data.type === 'context_indicators') {
                setContextIndicators(data.data)
              } else if (data.type === 'error') {
                throw new Error(data.message || 'Stream error')
              }
            } catch (e) {
              if (e instanceof SyntaxError) {
                console.error('Error parsing SSE data:', e)
              } else {
                throw e
              }
            }
          }
        }
      }
    } catch (err: unknown) {
      if (!isCurrent()) return
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      console.error('Error sending message:', error)
      toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToSendMessage'))
      setMessages(prev => prev.filter(msg => msg.id !== userMessageId))
    } finally {
      void operation.reader?.cancel().catch(() => { /* Also close errored streams. */ })
      operation.reader?.releaseLock()
      if (isCurrent()) {
        operationRef.current = null
        setIsStreaming(false)
        if (sessionId) {
          // Capture the actual target, including a just-created session. Never
          // refetch the observer's possibly changed selection after an await.
          const targetSessionId = sessionId
          const queryKey = ['sourceChatSession', sourceId, targetSessionId]
          try {
            await queryClient.cancelQueries({ queryKey, exact: true })
            if (isCurrent()) {
              const saved = await queryClient.fetchQuery({
                queryKey,
                queryFn: () => sourceChatApi.getSession(sourceId, targetSessionId),
                // Completion must bypass the production five-minute cache.
                staleTime: 0,
                retry: false
              })
              if (isCurrent()) {
                hydrateSessionRef.current = true
                setMessages(saved.messages)
                setContextIndicators(saved.context_indicators ?? null)
              }
            }
          } catch { /* Keep local text if the persisted-session refresh fails. */ }
        }
      }
    }
  }, [sourceId, queryClient, t])

  // Create session
  const createSession = useCallback((data: Omit<CreateSourceChatSessionRequest, 'source_id'>) => {
    cancelStreaming()
    return createSessionMutation.mutate({ data, source: sourceId, generation: generationRef.current })
  }, [createSessionMutation, cancelStreaming, sourceId])

  // Update session
  const updateSession = useCallback((sessionId: string, data: UpdateSourceChatSessionRequest) => {
    return updateSessionMutation.mutate({ sessionId, data })
  }, [updateSessionMutation])

  // Delete session
  const deleteSession = useCallback((sessionId: string) => {
    return deleteSessionMutation.mutate(sessionId)
  }, [deleteSessionMutation])

  return {
    // State
    sessions,
    currentSession: sessions.find(s => s.id === currentSessionId),
    currentSessionId,
    messages,
    isStreaming,
    contextIndicators,
    loadingSessions,
    
    // Actions
    createSession,
    updateSession,
    deleteSession,
    switchSession,
    sendMessage,
    cancelStreaming,
    refetchSessions
  }
}
