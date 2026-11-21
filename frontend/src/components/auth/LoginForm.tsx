'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getConfig } from '@/lib/config'
import type { AppConfig } from '@/lib/types/config'
import { useAuth, safeReturnPath } from '@/lib/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useTranslation } from '@/lib/hooks/use-translation'
import { SessionRecovery } from './SessionRecovery'

export function LoginForm() {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [config, setConfig] = useState<AppConfig | null>(null)
  useEffect(() => { let live = true; void getConfig().then(value => { if (live) setConfig(value) }).catch(() => {}); return () => { live = false } }, [])
  const { login, bootstrap, isLoading, error, hasHydrated, isAuthenticated, phase } = useAuth()
  const submitting = useRef(false)
  const router = useRouter()
  useEffect(() => {
    if (!isAuthenticated) return
    let path: string | null = null
    try { path = sessionStorage.getItem('redirectAfterLogin'); sessionStorage.removeItem('redirectAfterLogin') } catch { /* optional storage */ }
    router.replace(safeReturnPath(path))
  }, [isAuthenticated, router])
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!password.trim() || isLoading || submitting.current) return
    submitting.current = true
    try { await login(password) } finally { setPassword(''); submitting.current = false }
  }
  if (!hasHydrated || phase === 'bootstrapping') return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner /></div>
  if (phase === 'pending' || phase === 'refresh-needed') return <SessionRecovery />
  return <div className="min-h-screen flex items-center justify-center bg-background p-4">
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle>{t(phase === 'unavailable' ? 'auth.connectionPausedTitle' : 'auth.loginTitle')}</CardTitle>
        <CardDescription>{t(phase === 'unavailable' ? 'auth.connectionPausedHint' : 'auth.loginDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        {phase === 'unavailable' ? <div className="space-y-3">
          <p className="text-sm">{t('common.connectionError')}: {t('common.unableToConnect')}</p>
          <Button className="w-full" disabled={isLoading} onClick={() => void bootstrap()}>{t('common.retryConnection')}</Button>
          <details className="text-xs text-muted-foreground"><summary>{t('common.diagnosticInfo')}</summary><p>{t('auth.connectErrorHint')}</p>
            {config && <><p>{t('common.version')}: {config.version}</p><p>{t('common.built')}: {config.buildTime}</p><p>{t('common.apiUrl')}: {config.apiUrl || '/api'}</p></>}
            <p>{t('common.frontendUrl')}: {typeof window === 'undefined' ? '' : window.location.origin}</p><p>{t('common.checkConsoleLogs')}</p>
          </details>
        </div> : <form onSubmit={handleSubmit} className="space-y-4">
          <Input type="password" autoComplete="current-password" aria-label={t('auth.passwordPlaceholder')} placeholder={t('auth.passwordPlaceholder')} value={password} onChange={event => setPassword(event.target.value)} disabled={isLoading} />
          {error && <p role="alert" className="text-destructive text-sm">{t(error)}</p>}
          <Button type="submit" className="w-full" disabled={isLoading || !password.trim()}>{t(isLoading ? 'auth.signingIn' : 'auth.signIn')}</Button>
        </form>}
      </CardContent>
    </Card>
  </div>
}
