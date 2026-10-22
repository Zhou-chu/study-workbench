'use client'

import { useState, useEffect, useSyncExternalStore } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { Loader2, AlertCircle, CheckCircle2, XCircle, Clock } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { embeddingApi } from '@/lib/api/embedding'
import type { RebuildEmbeddingsRequest, RebuildStatusResponse } from '@/lib/api/embedding'
import { useTranslation } from '@/lib/hooks/use-translation'
import { parseCommandSubmissionUnknown, runCommandSubmission } from '@/lib/utils/command-submission'
import { isAuthRecoveryError } from '@/lib/api/browser-transport'
import { getApiErrorKey } from '@/lib/utils/error-handler'

// Metadata only: reactive across remounts, never durable across reloads.
interface RebuildSession {
  commandId: string | null
  pending: boolean
  unknown: boolean
  errorKey: string | null
}
const initialSession: RebuildSession = { commandId: null, pending: false, unknown: false, errorKey: null }
let session = initialSession
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const getSession = () => session
const getServerSession = () => initialSession
function updateSession(update: Partial<RebuildSession>) {
  session = { ...session, ...update }
  listeners.forEach(listener => listener())
}

export function RebuildEmbeddings() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'existing' | 'all'>('existing')
  const [includeSources, setIncludeSources] = useState(true)
  const [includeNotes, setIncludeNotes] = useState(true)
  const [includeInsights, setIncludeInsights] = useState(true)
  const { commandId, unknown, pending, errorKey } = useSyncExternalStore(subscribe, getSession, getServerSession)
  const [statusUnavailable, setStatusUnavailable] = useState(false)
  const [status, setStatus] = useState<RebuildStatusResponse | null>(null)
  // An acknowledged command is active even before the first status response.
  const rebuildMutation = useMutation({
    retry: false,
    mutationFn: async (request: RebuildEmbeddingsRequest) => {
      if (session.commandId || session.pending) return
      updateSession({ pending: true, errorKey: null })
      try {
        const data = await runCommandSubmission(
          'embeddings:rebuild',
          () => embeddingApi.rebuildEmbeddings(request),
          t('commandSubmission.newAttemptConfirm')
        )
        // Publish before resolving: mounted and remounted views share the same
        // accepted command, even if the initiating component no longer exists.
        // A new accepted attempt does not reconcile an older unknown attempt.
        updateSession({ commandId: data.command_id })
        return data
      } catch (error) {
        const uncertain = parseCommandSubmissionUnknown(error)
        if (uncertain) {
          updateSession({ unknown: true, ...(uncertain.command_id ? { commandId: uncertain.command_id } : {}) })
        } else {
          updateSession({ errorKey: getApiErrorKey(error, 'advanced.rebuild.failed') })
        }
        throw error
      } finally {
        updateSession({ pending: false })
      }
    }
  })

  useEffect(() => {
    if (!commandId) return
    setStatus(null)
    setStatusUnavailable(false)
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const next = await embeddingApi.getRebuildStatus(commandId)
        if (cancelled) return
        setStatus(next)
        setStatusUnavailable(false)
        if (next.status === 'completed' || next.status === 'failed') {
          if (session.commandId === commandId) updateSession({ commandId: null })
          return
        }
      } catch (error) {
        if (cancelled) return
        // An unavailable status never establishes rejection or permits replay.
        setStatusUnavailable(true)
        if (isAuthRecoveryError(error)) return
      }
      if (!cancelled) timer = setTimeout(poll, 5000)
    }
    void poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [commandId])

  const handleStartRebuild = () => {
    if (session.commandId || session.pending) return
    const request: RebuildEmbeddingsRequest = {
      mode,
      include_sources: includeSources,
      include_notes: includeNotes,
      include_insights: includeInsights
    }

    rebuildMutation.mutate(request)
  }

  const handleReset = () => {
    if (session.commandId || session.pending) return
    updateSession({ errorKey: null })
    setStatus(null)
    rebuildMutation.reset()
  }

  const isAnyTypeSelected = includeSources || includeNotes || includeInsights
  const isRebuildActive = !!commandId

  const progressData = status?.progress
  const stats = status?.stats

  const totalItems = progressData?.total_items ?? progressData?.total ?? 0
  const processedItems = progressData?.processed_items ?? progressData?.processed ?? 0
  const derivedProgressPercent = progressData?.percentage ?? (totalItems > 0 ? (processedItems / totalItems) * 100 : 0)
  const progressPercent = Number.isFinite(derivedProgressPercent) ? derivedProgressPercent : 0

  const sourcesProcessed = stats?.sources_processed ?? stats?.sources ?? 0
  const notesProcessed = stats?.notes_processed ?? stats?.notes ?? 0
  const insightsProcessed = stats?.insights_processed ?? stats?.insights ?? 0
  const failedItems = stats?.failed_items ?? stats?.failed ?? 0

  const computedDuration = status?.started_at && status?.completed_at
    ? (new Date(status.completed_at).getTime() - new Date(status.started_at).getTime()) / 1000
    : undefined
  const processingTimeSeconds = stats?.processing_time ?? computedDuration

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t('advanced.rebuildEmbeddings')}
        </CardTitle>
        <CardDescription>
          {t('advanced.rebuildEmbeddingsDesc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {unknown && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {t('commandSubmission.warning')} {t('commandSubmission.sessionOnly')}
            </AlertDescription>
          </Alert>
        )}
        {isRebuildActive && (!status || statusUnavailable) && (
          <Alert>
            <Clock className="h-4 w-4" />
            <AlertDescription>{t('commandSubmission.observing')}</AlertDescription>
          </Alert>
        )}
        {/* Configuration Form */}
        {!isRebuildActive && (
          <div className="space-y-6">
            <div className="space-y-3">
              <Label htmlFor="mode">{t('advanced.rebuild.mode')}</Label>
              <Select value={mode} onValueChange={(value) => setMode(value as 'existing' | 'all')}>
                <SelectTrigger id="mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="existing">{t('advanced.rebuild.existing')}</SelectItem>
                  <SelectItem value="all">{t('advanced.rebuild.all')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                {mode === 'existing'
                  ? t('advanced.rebuild.existingDesc')
                  : t('advanced.rebuild.allDesc')}
              </p>
            </div>

            <div className="space-y-3" role="group" aria-labelledby="include-label">
              <span id="include-label" className="text-sm font-medium leading-none">{t('advanced.rebuild.include')}</span>
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="sources"
                    checked={includeSources}
                    onCheckedChange={(checked) => setIncludeSources(checked === true)}
                  />
                  <Label htmlFor="sources" className="font-normal cursor-pointer">
                    {t('navigation.sources')}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="notes"
                    checked={includeNotes}
                    onCheckedChange={(checked) => setIncludeNotes(checked === true)}
                  />
                  <Label htmlFor="notes" className="font-normal cursor-pointer">
                    {t('common.notes')}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="insights"
                    checked={includeInsights}
                    onCheckedChange={(checked) => setIncludeInsights(checked === true)}
                  />
                  <Label htmlFor="insights" className="font-normal cursor-pointer">
                    {t('common.insights')}
                  </Label>
                </div>
              </div>
              {!isAnyTypeSelected && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {t('advanced.rebuild.selectOneError')}
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <Button
              onClick={handleStartRebuild}
              disabled={!isAnyTypeSelected || pending}
              className="w-full"
            >
              {pending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('advanced.rebuild.starting')}
                </>
              ) : (
                t('advanced.rebuild.startBtn')
              )}
            </Button>

            {errorKey && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {unknown && <p>{t('commandSubmission.newAttemptError')}</p>}
                  <p>{t(errorKey)}</p>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Status Display */}
        {status && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {status.status === 'queued' && <Clock className="h-5 w-5 text-warn" />}
                {status.status === 'running' && <Loader2 className="h-5 w-5 text-teal animate-spin" />}
                {status.status === 'completed' && <CheckCircle2 className="h-5 w-5 text-fern" />}
                {status.status === 'failed' && <XCircle className="h-5 w-5 text-destructive" />}
                <div className="flex flex-col">
                  <span className="font-medium">
                    {status.status === 'queued' && t('advanced.rebuild.queued')}
                    {status.status === 'running' && t('advanced.rebuild.running')}
                    {status.status === 'completed' && t('advanced.rebuild.completed')}
                    {status.status === 'failed' && t('advanced.rebuild.failed')}
                  </span>
                  {status.status === 'running' && (
                    <span className="text-sm text-muted-foreground">
                      {t('advanced.rebuild.leavePageHint')}
                    </span>
                  )}
                </div>
              </div>
              {(status.status === 'completed' || status.status === 'failed') && (
                <Button variant="outline" size="sm" onClick={handleReset}>
                  {t('advanced.rebuild.startNew')}
                </Button>
              )}
            </div>

            {progressData && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>{t('common.progress')}</span>
                  <span className="font-medium">
                    {t('advanced.rebuild.itemsProcessed', { processed: processedItems.toString(), total: totalItems.toString(), percent: progressPercent.toFixed(1) })}
                  </span>
                </div>
                <Progress value={progressPercent} className="h-2" />
                {failedItems > 0 && (
                  <p className="text-sm text-warn">
                    ⚠️ {t('advanced.rebuild.failedItems', { count: failedItems })}
                  </p>
                )}
              </div>
            )}

             {stats && (
              <div className="grid grid-cols-4 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{t('navigation.sources')}</p>
                  <p className="font-mono text-2xl font-bold">{sourcesProcessed}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{t('common.notes')}</p>
                  <p className="font-mono text-2xl font-bold">{notesProcessed}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{t('common.insights')}</p>
                  <p className="font-mono text-2xl font-bold">{insightsProcessed}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{t('advanced.rebuild.time')}</p>
                  <p className="font-mono text-2xl font-bold">
                    {processingTimeSeconds !== undefined ? `${processingTimeSeconds.toFixed(1)}s` : '—'}
                  </p>
                </div>
              </div>
            )}

            {status.error_message && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{t('advanced.rebuild.failed')}</AlertDescription>
              </Alert>
            )}

            {status.started_at && (
              <div className="text-sm text-muted-foreground space-y-1">
                <p>{t('common.created', { time: new Date(status.started_at).toLocaleString() })}</p>
                {status.completed_at && (
                  <p>{t('notebooks.updated')}: {new Date(status.completed_at).toLocaleString()}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Help Section */}
         <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="when">
            <AccordionTrigger>{t('advanced.rebuild.whenToRebuild')}</AccordionTrigger>
            <AccordionContent className="space-y-2 text-sm">
              <p>{t('advanced.rebuild.whenToRebuildAns')}</p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="time">
            <AccordionTrigger>{t('advanced.rebuild.howLong')}</AccordionTrigger>
            <AccordionContent className="space-y-2 text-sm">
              <p>{t('advanced.rebuild.howLongAns')}</p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="safe">
            <AccordionTrigger>{t('advanced.rebuild.isSafe')}</AccordionTrigger>
            <AccordionContent className="space-y-2 text-sm">
              <p>{t('advanced.rebuild.isSafeAns')}</p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  )
}
