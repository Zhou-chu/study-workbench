import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInstance } from 'i18next'
import { resources } from '@/lib/locales'
import * as credentials from './use-credentials'
import * as models from './use-models'
import * as podcasts from './use-podcasts'
import * as notes from './use-notes'
import * as notebooks from './use-notebooks'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  invalidateQueries: vi.fn(),
  refetchQueries: vi.fn(),
  onError: undefined as undefined | ((error: unknown) => void),
  t: vi.fn<(key: string) => string>(),
}))
vi.mock('@/lib/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/lib/hooks/use-translation', () => ({ useTranslation: () => ({ t: mocks.t }) }))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQueryClient: () => mocks,
  useMutation: (options: { onError: (error: unknown) => void }) => {
    mocks.onError = options.onError
    return {}
  },
}))

// Capture mutation callbacks without invoking API functions or using credentials.
const cases: [string, () => unknown, string][] = [
  ['create credential', credentials.useCreateCredential, 'common.error'],
  ['update credential', credentials.useUpdateCredential, 'common.error'],
  ['delete credential', credentials.useDeleteCredential, 'common.error'],
  ['test credential', credentials.useTestCredential, 'apiKeys.testFailed'],
  ['discover models', credentials.useDiscoverModels, 'apiKeys.syncFailed'],
  ['register models', credentials.useRegisterModels, 'apiKeys.syncFailed'],
  ['migrate environment', credentials.useMigrateFromEnv, 'common.error'],
  ['migrate provider config', credentials.useMigrateFromProviderConfig, 'common.error'],
  ['create model', models.useCreateModel, 'common.error'],
  ['delete model', models.useDeleteModel, 'common.error'],
  ['update defaults', models.useUpdateModelDefaults, 'common.error'],
  ['auto assign', models.useAutoAssignDefaults, 'common.error'],
  ['retry episode', podcasts.useRetryPodcastEpisode, 'common.error'],
  ['delete episode', podcasts.useDeletePodcastEpisode, 'common.error'],
  ['create episode profile', podcasts.useCreateEpisodeProfile, 'common.error'],
  ['update episode profile', podcasts.useUpdateEpisodeProfile, 'common.error'],
  ['delete episode profile', podcasts.useDeleteEpisodeProfile, 'podcasts.failedToDeleteProfileDesc'],
  ['duplicate episode profile', podcasts.useDuplicateEpisodeProfile, 'common.error'],
  ['create speaker', podcasts.useCreateSpeakerProfile, 'common.error'],
  ['update speaker', podcasts.useUpdateSpeakerProfile, 'common.error'],
  ['delete speaker', podcasts.useDeleteSpeakerProfile, 'podcasts.failedToDeleteSpeakerDesc'],
  ['duplicate speaker', podcasts.useDuplicateSpeakerProfile, 'common.error'],
  ['generate podcast', podcasts.useGeneratePodcast, 'podcasts.tryAgainMoment'],
  ['create note', notes.useCreateNote, 'notebooks.failedToCreateNote'],
  ['update note', notes.useUpdateNote, 'notebooks.failedToUpdateNote'],
  ['delete note', notes.useDeleteNote, 'notebooks.failedToDeleteNote'],
  ['create notebook', notebooks.useCreateNotebook, 'common.error'],
  ['update notebook', notebooks.useUpdateNotebook, 'common.error'],
  ['delete notebook', notebooks.useDeleteNotebook, 'common.error'],
]

describe.each(['en-US', 'zh-CN'])('mutation error translations in %s', (language) => {
  const i18n = createInstance()
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.onError = undefined
    await i18n.init({ resources, lng: language, fallbackLng: false, initAsync: false })
    mocks.t.mockImplementation((key) => i18n.t(key))
  })

  it.each(cases)('%s translates mapped errors and sanitizes unknown failures', (_name, useHook, fallback) => {
    const { unmount } = renderHook(useHook)
    for (const [detail, expectedKey, status] of [
      ['Missing authorization: synthetic-private-value', 'apiErrors.unauthorized', 401],
      ['synthetic-private-value', fallback, 400],
    ] as const) {
      mocks.t.mockClear()
      act(() => mocks.onError?.({ response: { status, data: { detail } } }))
      expect(mocks.toast).toHaveBeenLastCalledWith(expect.objectContaining({
        description: i18n.t(expectedKey),
        variant: 'destructive',
      }))
      expect(mocks.t).toHaveBeenCalledWith(expectedKey)
      expect(JSON.stringify(mocks.toast.mock.calls)).not.toContain('synthetic-private-value')
      expect(JSON.stringify(mocks.toast.mock.calls)).not.toContain('apiErrors.')
    }
    expect(mocks.invalidateQueries).not.toHaveBeenCalled()
    expect(mocks.refetchQueries).not.toHaveBeenCalled()
    unmount()
  })
})

it('all mapped error and fallback keys exist in every locale without fallback', async () => {
  const { ERROR_MAP } = await import('@/lib/utils/error-handler')
  const keys = [...new Set([...Object.values(ERROR_MAP), ...cases.map(([, , key]) => key)])]
  for (const language of Object.keys(resources)) {
    const i18n = createInstance()
    await i18n.init({ resources, lng: language, fallbackLng: false, initAsync: false })
    for (const key of keys) expect(i18n.exists(key), language + ': ' + key).toBe(true)
  }
})
