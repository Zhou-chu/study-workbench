'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRecoveryBannerHost } from '@/lib/hooks/use-recovery-banner-host'
import { ConnectionError } from '@/lib/types/config'
import { ConnectionErrorOverlay } from '@/components/errors/ConnectionErrorOverlay'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getConfig, resetConfig } from '@/lib/config'

interface ConnectionGuardProps {
  children: React.ReactNode
}

export function ConnectionGuard({ children }: ConnectionGuardProps) {
  const { t } = useTranslation()
  const [error, setError] = useState<ConnectionError | null>(null)
  const [isChecking, setIsChecking] = useState(true)
  const [hasConnected, setHasConnected] = useState(false)
  const bannerHost = useRecoveryBannerHost(hasConnected && !!error, true)
  // Use a ref to track checking status to avoid dependency cycles
  const isCheckingRef = useRef(false)

  const checkConnection = useCallback(async () => {
    // Prevent re-entry if already checking
    if (isCheckingRef.current) {
       return
    }
    
    isCheckingRef.current = true
    setIsChecking(true)
    
    setError(null)

    // Reset config cache to force a fresh fetch
    resetConfig()

    try {
      const config = await getConfig()

      // Check if database is offline
      if (config.dbStatus === 'offline') {
        const dbError: ConnectionError = {
          type: 'database-offline',
          details: {
            message: 'Database is offline', // Fallback message, UI will translate
            attemptedUrl: config.apiUrl,
          },
        }
        setError(dbError)
        isCheckingRef.current = false
        setIsChecking(false)
        return
      }

      // Once connected, keep the mounted work even across later checks.
      setHasConnected(true)
      setError(null)
      isCheckingRef.current = false
      setIsChecking(false)
    } catch (err) {
      // API is unreachable
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      const attemptedUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}/api/config`
          : undefined

      const apiError: ConnectionError = {
        type: 'api-unreachable',
        details: {
          message: 'Unable to connect to API', // Fallback message
          technicalMessage: errorMessage,
          stack: err instanceof Error ? err.stack : undefined,
          attemptedUrl,
        },
      }
      
      setError(apiError)
      isCheckingRef.current = false
      setIsChecking(false)
    }
  }, []) // Empty dependency array - stable callback

  // Check connection on mount
  useEffect(() => {
    void checkConnection()
    const recheck = () => { void checkConnection() }
    window.addEventListener('online', recheck)
    return () => window.removeEventListener('online', recheck)
  }, [checkConnection])

  // Add keyboard shortcut for retry (R key)
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.matches('input, textarea, [contenteditable=true]')) return
      if (error && !e.ctrlKey && !e.metaKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault()
        checkConnection()
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [error, checkConnection])

  return <>
    {(hasConnected || (!error && !isChecking)) && <div>{children}</div>}
    {error && (hasConnected ? bannerHost && createPortal(<section role="alert" className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-2xl rounded-lg border bg-card p-4 shadow-overlay space-y-2">
      <h2 className="font-semibold">{t('auth.connectionPausedTitle')}</h2><p className="text-sm">{t('auth.draftsPreserved')}</p>
      <Button disabled={isChecking} onClick={() => void checkConnection()}>{t('auth.checkConnection')}</Button>
    </section>, bannerHost) : <ConnectionErrorOverlay error={error} onRetry={checkConnection} />)}
  </>
}
