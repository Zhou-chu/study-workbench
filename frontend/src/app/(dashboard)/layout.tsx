'use client'

import { useAuth, safeReturnPath } from '@/lib/hooks/use-auth'
import { useVersionCheck } from '@/lib/hooks/use-version-check'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { ModalProvider } from '@/components/providers/ModalProvider'
import { CreateDialogsProvider } from '@/lib/hooks/use-create-dialogs'
import { CommandPalette } from '@/components/common/CommandPalette'
import { SessionRecovery } from '@/components/auth/SessionRecovery'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, phase, signedOutLocally } = useAuth()
  const router = useRouter()
  const [hasMountedWork, setHasMountedWork] = useState(false)
  useVersionCheck()
  useEffect(() => {
    if (isAuthenticated) setHasMountedWork(true)
    else if (!hasMountedWork && !isLoading && (phase === 'anonymous' || phase === 'reauth-required')) {
      try { sessionStorage.setItem('redirectAfterLogin', safeReturnPath(window.location.pathname + window.location.search)) } catch { /* optional storage */ }
      router.replace('/login')
    }
  }, [hasMountedWork, isAuthenticated, isLoading, phase, router])
  if (!hasMountedWork && !isAuthenticated) {
    if (isLoading) return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner /></div>
    return <SessionRecovery />
  }
  // Once mounted, neither auth changes nor a background recheck replace the
  // editor, query cache, modal, upload File objects or operation identities.
  return <ErrorBoundary>
    <CreateDialogsProvider>
      <div inert={signedOutLocally} aria-hidden={signedOutLocally || undefined}>{children}<ModalProvider /><CommandPalette /></div>
      <SessionRecovery />
    </CreateDialogsProvider>
  </ErrorBoundary>
}
