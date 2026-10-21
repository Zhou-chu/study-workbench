'use client'

import { useSyncExternalStore } from 'react'

// One observer is shared by recovery banners. Existing editor modals own focus
// and pointer access: move only the banner, never the editor or its portal.
let host: Element | null = null
let topHost: Element | null = null
let observer: MutationObserver | null = null
const listeners = new Set<() => void>()
const emptySnapshot = () => null
const inactiveSubscription = () => () => {}
function updateHost() {
  const dialogs = Array.from(document.querySelectorAll('[role=dialog][data-state=open], [role=alertdialog][data-state=open]'))
  const editorDialogs = dialogs.filter(dialog => !dialog.hasAttribute('data-session-recovery'))
  const next = editorDialogs.at(-1) || document.body
  const top = dialogs.at(-1) || document.body
  if (host === next && topHost === top) return
  host = next; topHost = top
  listeners.forEach(listener => listener())
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!observer) {
    updateHost()
    observer = new MutationObserver(updateHost)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] })
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) { observer?.disconnect(); observer = null; host = null; topHost = null }
  }
}
// Auth recovery excludes its own dialog; config-only recovery may enter that
// locked boundary without changing authentication or the private subtree.
export function useRecoveryBannerHost(active: boolean, includeRecoveryDialog = false): Element | null {
  return useSyncExternalStore(active ? subscribe : inactiveSubscription, active ? () => (includeRecoveryDialog ? topHost : host) : emptySnapshot, emptySnapshot)
}
