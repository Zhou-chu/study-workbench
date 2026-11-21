'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useAuthStore } from '@/lib/stores/auth-store'
import { useRecoveryBannerHost } from '@/lib/hooks/use-recovery-banner-host'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Dialog, DialogPortal, DialogOverlay, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** A recoverable banner keeps local editing/copying available. Password entry
 * is explicit; only deliberate sign-out locks the retained private subtree. */
export function SessionRecovery() {
  const { t } = useTranslation()
  const { phase, isLoading, error, login, bootstrap, refresh, signoutLocal, signedOutLocally, serverRevocation, localSignoutConfirmed, session } = useAuthStore()
  const [password, setPassword] = useState('')
  const [signInOpen, setSignInOpen] = useState(false)
  const bannerHost = useRecoveryBannerHost(phase !== 'authenticated' && phase !== 'bootstrapping')
  const submitting = useRef(false)
  const editorFocus = useRef<HTMLElement | null>(null)
  const editorDialog = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const rememberFocus = () => {
      const active = document.activeElement
      if (!(active instanceof HTMLElement) || active === document.body || active.closest('[data-session-recovery], [data-testid=session-recovery]')) return
      editorFocus.current = active
      editorDialog.current = active.closest('[role=dialog], [role=alertdialog]')
    }
    rememberFocus()
    document.addEventListener('focusin', rememberFocus)
    return () => document.removeEventListener('focusin', rememberFocus)
  }, [])
  const restoreFocus = (event: Event) => {
    event.preventDefault()
    const visible = (node: HTMLElement | null): node is HTMLElement => !!node?.isConnected && !node.matches(':disabled, [disabled]') && !node.closest('[hidden], [inert], [aria-hidden=true]') && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden'
    const trigger = document.querySelector<HTMLElement>('[data-session-recovery-trigger]')
    const fallbacks = editorDialog.current?.querySelectorAll<HTMLElement>('textarea, input, button, a[href], [tabindex], [contenteditable=true]') || []
    for (const target of [trigger, editorFocus.current, ...fallbacks]) {
      if (!visible(target)) continue
      target.focus({ preventScroll: true })
      // A connected node may have become nonfocusable while sign-in ran.
      // Continue rather than abandoning keyboard users on document.body.
      if (document.activeElement === target) break
    }
  }
  const needsPassword = phase === 'reauth-required' || phase === 'anonymous' || (signedOutLocally && !session)
  useEffect(() => { if (!needsPassword) { setPassword(''); setSignInOpen(false) } }, [needsPassword])
  if (phase === 'authenticated' || phase === 'bootstrapping') return null
  const title = signedOutLocally && needsPassword ? 'auth.signedOutTitle' : {
    pending: 'auth.finishingSignIn', 'refresh-needed': 'auth.sessionCheckTitle',
    'reauth-required': 'auth.reauthenticateTitle', unavailable: 'auth.connectionPausedTitle', anonymous: 'auth.reauthenticateTitle',
  }[phase]
  const hint = phase === 'pending' ? 'auth.pendingHint' : phase === 'unavailable' ? 'auth.connectionPausedHint' : phase === 'refresh-needed' ? 'auth.sessionCheckHint' : 'auth.reauthenticateHint'
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!password.trim() || submitting.current || isLoading) return
    submitting.current = true
    try { await login(password) } finally { setPassword(''); submitting.current = false }
  }
  const dialogOpen = signedOutLocally || (needsPassword && signInOpen)
  return <>
    {!signedOutLocally && !dialogOpen && bannerHost && createPortal(<section data-testid="session-recovery" role="status" aria-live="polite" className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-2xl rounded-lg border bg-card p-4 shadow-overlay space-y-2">
      <h2 className="font-semibold">{t(title)}</h2>
      <p className="text-sm text-muted-foreground">{t('auth.draftsPreserved')}</p>
      <p className="text-sm text-muted-foreground">{t(hint)}</p>
      {error && <p className="text-sm text-destructive">{t(error)}</p>}
      <Button data-session-recovery-trigger disabled={isLoading} onClick={() => needsPassword ? setSignInOpen(true) : void (phase === 'refresh-needed' ? refresh() : bootstrap())}>{t(needsPassword ? 'auth.signIn' : phase === 'refresh-needed' ? 'auth.resumeSession' : phase === 'pending' ? 'auth.finishSignIn' : 'auth.checkConnection')}</Button>
      <p className="text-xs text-muted-foreground">{t('auth.noAutomaticResubmit')}</p>
    </section>, bannerHost)}
    <Dialog open={dialogOpen} onOpenChange={open => { if (!signedOutLocally) { setSignInOpen(open); if (!open) setPassword('') } }}>
      <DialogPortal><DialogOverlay className={signedOutLocally ? 'bg-background' : undefined} /><DialogPrimitive.Content data-session-recovery className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-5 rounded-xl border bg-card p-6 shadow-overlay" aria-describedby="session-recovery-description"
        onCloseAutoFocus={restoreFocus}
        onEscapeKeyDown={event => { if (signedOutLocally) event.preventDefault() }} onInteractOutside={event => { if (signedOutLocally) event.preventDefault() }}>
        <DialogHeader>
          <DialogTitle>{t(title)}</DialogTitle>
          <DialogDescription id="session-recovery-description">{t('auth.draftsPreserved')}</DialogDescription>
        </DialogHeader>
        {serverRevocation === 'unconfirmed' && <p className="text-sm text-muted-foreground">{t(localSignoutConfirmed === false ? 'auth.signoutUnconfirmed' : 'auth.remoteRevocationUnconfirmed')}</p>}
        {serverRevocation === 'confirmed' && <p className="text-sm text-muted-foreground">{t('auth.remoteRevocationConfirmed')}</p>}
        {error && error !== 'auth.signoutUnconfirmed' && <p role="alert" className="text-sm text-destructive">{t(error)}</p>}
        {needsPassword ? <form className="space-y-3" onSubmit={submit}>
          <Input type="password" autoComplete="current-password" aria-label={t('auth.passwordPlaceholder')} placeholder={t('auth.passwordPlaceholder')} value={password} disabled={isLoading} onChange={event => setPassword(event.target.value)} />
          <Button type="submit" className="w-full" disabled={isLoading || !password.trim()}>{t(isLoading ? 'auth.signingIn' : 'auth.signIn')}</Button>
        </form> : <Button disabled={isLoading} onClick={() => void (phase === 'refresh-needed' ? refresh() : bootstrap())}>{t(phase === 'refresh-needed' ? 'auth.resumeSession' : phase === 'pending' ? 'auth.finishSignIn' : 'auth.checkConnection')}</Button>}
        {signedOutLocally && localSignoutConfirmed === false && <Button variant="outline" disabled={isLoading} onClick={() => void signoutLocal()}>{t('auth.retrySignout')}</Button>}
        <p className="text-xs text-muted-foreground">{t('auth.noAutomaticResubmit')}</p>
        {!signedOutLocally && <Button variant="outline" onClick={() => { setSignInOpen(false); setPassword('') }}>{t('common.close')}</Button>}
      </DialogPrimitive.Content></DialogPortal>
    </Dialog>
  </>
}
