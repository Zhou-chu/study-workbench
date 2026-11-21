import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {getAuthToken, purgeLegacyAuth, setLegacyAuthToken} from './legacy-auth.js'

const key = 'auth-storage'
const saved = (token: string) => JSON.stringify({state:{token,isAuthenticated:true},version:0})
let raw: string | null
const localStorage = {
  getItem: vi.fn((_key: string) => raw),
  setItem: vi.fn((_key: string, value: string) => { raw=value }),
  removeItem: vi.fn((_key: string) => { raw=null }),
}
function fixture() {
  const entries = new Map<string, Set<(event: StorageEvent) => void>>()
  const window = {
    localStorage,
    addEventListener: vi.fn((type: string, listener: (event: StorageEvent) => void) => {
      if (!entries.has(type)) entries.set(type,new Set())
      entries.get(type)!.add(listener)
    }),
    removeEventListener: vi.fn((type: string, listener: (event: StorageEvent) => void) => { entries.get(type)?.delete(listener) }),
  }
  const storageEvent=(changed: string|null)=>entries.get('storage')?.forEach(fn=>fn({key:changed} as StorageEvent))
  vi.stubGlobal('window',window)
  return {window,storageEvent}
}
beforeEach(() => { vi.clearAllMocks(); raw=null })
afterEach(() => { purgeLegacyAuth(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('round-trips the explicitly entered legacy value while re-reading normal browser storage', () => {
  fixture()
  setLegacyAuthToken('example-session')
  expect(localStorage.setItem).toHaveBeenCalledWith(key,saved('example-session'))
  expect(getAuthToken('legacy_password')).toBe('example-session')
  raw=saved('another-local-session')
  expect(getAuthToken('legacy_password')).toBe('another-local-session')
  raw=null
  expect(getAuthToken('legacy_password')).toBeNull()
  expect(localStorage.getItem).toHaveBeenCalledTimes(3)
})

it('keeps storage untouched when caller configuration is not explicitly legacy', () => {
  fixture()
  raw=saved('example-session')
  expect(getAuthToken()).toBeNull()
  expect(getAuthToken('device_sessions')).toBeNull()
  expect(localStorage.getItem).not.toHaveBeenCalled()
})

it.each(['not-json',saved('not-required'),JSON.stringify({state:{token:12}})])('clears an unusable legacy entry %j without failing a read',stored=>{
  fixture()
  setLegacyAuthToken('example-session')
  raw=stored
  expect(getAuthToken('legacy_password')).toBeNull()
})

it('keeps a storage-quota login in memory only until the stored baseline changes', () => {
  const {window}=fixture()
  raw=saved('previous')
  localStorage.setItem.mockImplementationOnce(()=>{throw Error('quota full')})
  setLegacyAuthToken('new')
  expect(getAuthToken('legacy_password')).toBe('new')
  expect(window.addEventListener).toHaveBeenCalledOnce()
  raw=saved('from-another-tab')
  expect(getAuthToken('legacy_password')).toBe('from-another-tab')
  expect(window.removeEventListener).toHaveBeenCalled()
})

it.each([key,null])('clears a quota-fallback value on the relevant storage change signal %s',changed=>{
  const {storageEvent}=fixture()
  localStorage.setItem.mockImplementationOnce(()=>{throw Error('quota full')})
  setLegacyAuthToken('example-session')
  storageEvent('theme')
  expect(getAuthToken('legacy_password')).toBe('example-session')
  storageEvent(changed)
  expect(getAuthToken('legacy_password')).toBeNull()
})

it('works with unavailable storage, then forgets the memory value even if durable purge fails',()=>{
  fixture()
  localStorage.setItem.mockImplementationOnce(()=>{throw Error('disabled storage')})
  localStorage.getItem.mockImplementationOnce(()=>{throw Error('disabled storage')})
  setLegacyAuthToken('example-session')
  localStorage.getItem.mockImplementationOnce(()=>{throw Error('disabled storage')})
  expect(getAuthToken('legacy_password')).toBe('example-session')
  localStorage.removeItem.mockImplementationOnce(()=>{throw Error('disabled storage')})
  expect(purgeLegacyAuth()).toBe(false)
  localStorage.getItem.mockImplementationOnce(()=>{throw Error('disabled storage')})
  expect(getAuthToken('legacy_password')).toBeNull()
})

it('allows no browser-storage access during a server read or purge',()=>{
  expect(getAuthToken('legacy_password')).toBeNull()
  expect(purgeLegacyAuth()).toBe(false)
  expect(localStorage.getItem).not.toHaveBeenCalled()
  expect(localStorage.removeItem).not.toHaveBeenCalled()
})
