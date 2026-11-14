'use client'

import { useAuthStore } from '@/lib/stores/auth-store'
import { useEffect } from 'react'

/** Same-origin relative return paths only; browser URL normalization must not
 * turn slashes, backslashes or control characters into an external destination.
 */
export function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return '/notebooks'
  try {
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(decoded)) return '/notebooks'
  } catch { return '/notebooks' }
  return value
}
export function useAuth() {
  const state = useAuthStore()
  const { hasHydrated, bootstrap } = state
  useEffect(() => {
    if (!hasHydrated) void bootstrap()
  }, [hasHydrated, bootstrap])
  // Runtime recovery never navigates. LoginForm alone handles cold-entry return.
  return { ...state, isLoading: state.isLoading || !state.hasHydrated }
}
