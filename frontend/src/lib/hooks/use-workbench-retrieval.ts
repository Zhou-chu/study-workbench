'use client'
import { useEffect, useReducer, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { currentSemanticStatus, semanticOptionsAllowed, useSemanticStatus } from './use-semantic-status'
import { captureEmbeddingDisclosure } from '@/lib/workbench/embedding-disclosure'
import type { RetrievalOptions } from '@/lib/types/personal'
import { copyRetrievalOptions, queryDisclosureIdentity, readTurnContext, subscribeTurnContext } from '@/lib/workbench/turn-context'

/** Consent is document-local and generation-bound, not a persisted Boolean. */
export function useWorkbenchRetrieval(notebookId: string, sourceVersionIds: readonly string[]) {
  const client = useQueryClient()
  const status = useSemanticStatus(notebookId, sourceVersionIds)
  const [, render] = useReducer(value => value + 1, 0)
  const choice = useRef({ notebookId, mode: 'lexical' as 'lexical' | 'hybrid', profileId: null as string | null })
  if (choice.current.notebookId !== notebookId) choice.current = { notebookId, mode: 'lexical', profileId: null }
  const latest = useRef({ notebookId, sourceVersionIds }); latest.current = { notebookId, sourceVersionIds }
  const owner = useRef({ fingerprint: '', generation: 0 })
  const ack = useRef<number | null>(null)
  const profile = () => currentSemanticStatus(client, latest.current.notebookId, latest.current.sourceVersionIds)?.profiles.find(row => row.profile.profile_id === choice.current.profileId)?.profile
  const sync = () => {
    const current = profile()
    const fingerprint = JSON.stringify([latest.current.notebookId, latest.current.sourceVersionIds, choice.current, current ? queryDisclosureIdentity(current) : null, readTurnContext(), currentSemanticStatus(client, latest.current.notebookId, latest.current.sourceVersionIds)?.enabled])
    if (owner.current.fingerprint !== fingerprint) { owner.current = { fingerprint, generation: owner.current.generation + 1 }; ack.current = null }
    return owner.current.generation
  }
  sync()
  const changed = () => { const previous = owner.current.generation; if (sync() !== previous) render() }
  const syncRef = useRef(changed); syncRef.current = changed
  useEffect(() => {
    const stopContext = subscribeTurnContext(() => syncRef.current())
    const stopCache = client.getQueryCache().subscribe(event => {
      if ((event.type === 'updated' || event.type === 'removed') && event.query.queryKey[0] === 'personal' && event.query.queryKey[1] === 'semantic-index' && event.query.queryKey[2] === latest.current.notebookId) syncRef.current()
    })
    return () => { stopContext(); stopCache() }
  }, [client])
  const readOptions = (): Readonly<RetrievalOptions> => {
    sync()
    if (choice.current.mode === 'lexical') return Object.freeze({ retrieval_mode: 'lexical' })
    const current = profile()
    return copyRetrievalOptions({ retrieval_mode: 'hybrid', embedding_profile_id: choice.current.profileId, disclosed_profile_fingerprint: current?.fingerprint ?? null, destination_descriptor_version: current?.destination_descriptor_version ?? null, acknowledge_query_processing: ack.current === owner.current.generation })
  }
  const options = readOptions()
  const renderedGeneration = owner.current.generation
  const renderedProfile = profile()
  const renderedIdentity = renderedProfile ? queryDisclosureIdentity(renderedProfile) : null
  const renderedMode = choice.current.mode
  const renderedDisclosure = renderedProfile ? captureEmbeddingDisclosure(renderedProfile) : null
  const ownsRenderedDisclosure = () => {
    const generation = sync(); const current = profile()
    return generation === renderedGeneration && choice.current.mode === renderedMode && !!current && !!renderedIdentity && queryDisclosureIdentity(current) === renderedIdentity
  }
  return {
    status, generation: owner.current.generation, readGeneration: sync, mode: choice.current.mode, profileId: choice.current.profileId, profile: profile(), disclosure: renderedDisclosure, options,
    queryAcknowledged: ack.current === owner.current.generation,
    available: semanticOptionsAllowed(client, notebookId, sourceVersionIds, options) && (renderedMode !== 'hybrid' || !!renderedDisclosure),
    readOptions, readDisclosure: () => renderedMode === 'hybrid' && ownsRenderedDisclosure() ? renderedDisclosure : null, readChoice: () => ({ ...choice.current }),
    setMode(mode: 'lexical' | 'hybrid') { choice.current.mode = mode; sync(); render() },
    setProfile(profileId: string | null) { choice.current.profileId = profileId; sync(); render() },
    acknowledge(value: boolean) { ack.current = value && renderedMode === 'hybrid' && ownsRenderedDisclosure() ? renderedGeneration : null; render() },
  }
}
