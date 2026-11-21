import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import type { ComponentProps, PropsWithChildren } from 'react'
import { resources } from '@/lib/locales'
import { CredentialFormDialog } from './CredentialFormDialog'

// Keep the real translation hook/resources; only the API-facing hooks are mocked.
vi.unmock('@/lib/hooks/use-translation')

const mutations = vi.hoisted(() => ({
  create: { isPending: false, mutate: vi.fn() },
  update: { isPending: false, mutate: vi.fn() },
}))

vi.mock('@/lib/hooks/use-credentials', () => ({
  useCreateCredential: () => mutations.create,
  useUpdateCredential: () => mutations.update,
}))

const providers = [
  { name: 'openai', display_name: 'OpenAI', modalities: ['language'], env_configured: false },
  { name: 'anthropic', display_name: 'Anthropic', modalities: ['language'], env_configured: false },
]

vi.mock('@/lib/hooks/use-providers', () => ({
  useProviders: () => ({ data: providers }),
}))

const i18n = createInstance()
type DialogProps = ComponentProps<typeof CredentialFormDialog>

beforeEach(async () => {
  vi.clearAllMocks()
  mutations.create.isPending = false
  mutations.update.isPending = false
  await i18n.init({ resources, lng: 'en-US', fallbackLng: false, initAsync: false })
})

function renderDialog(provider: string, props: Partial<DialogProps> = {}) {
  return render(
    <CredentialFormDialog
      open
      onOpenChange={vi.fn()}
      provider={provider}
      {...props}
    />,
    { wrapper: ({ children }: PropsWithChildren) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider> },
  )
}

function apiKeyInput() {
  return screen.getByLabelText(i18n.t('models.apiKey'))
}

describe('CredentialFormDialog', () => {
  it.each([
    ['bn-IN', 'দেখান', 'লুকান', 'API কী দেখান', 'API কী লুকান'],
    ['ca-ES', 'Mostra', 'Amaga', 'Mostra la clau API', 'Amaga la clau API'],
    ['de-DE', 'Anzeigen', 'Verbergen', 'API-Schlüssel anzeigen', 'API-Schlüssel verbergen'],
    ['en-US', 'Show', 'Hide', 'Show API key', 'Hide API key'],
    ['es-ES', 'Mostrar', 'Ocultar', 'Mostrar clave API', 'Ocultar clave API'],
    ['fr-FR', 'Afficher', 'Masquer', 'Afficher la clé API', 'Masquer la clé API'],
    ['it-IT', 'Mostra', 'Nascondi', 'Mostra chiave API', 'Nascondi chiave API'],
    ['ja-JP', '表示', '非表示', 'API キーを表示', 'API キーを非表示'],
    ['pl-PL', 'Pokaż', 'Ukryj', 'Pokaż klucz API', 'Ukryj klucz API'],
    ['pt-BR', 'Mostrar', 'Ocultar', 'Mostrar chave de API', 'Ocultar chave de API'],
    ['ru-RU', 'Показать', 'Скрыть', 'Показать ключ API', 'Скрыть ключ API'],
    ['tr-TR', 'Göster', 'Gizle', 'API anahtarını göster', 'API anahtarını gizle'],
    ['zh-CN', '显示', '隐藏', '显示 API 密钥', '隐藏 API 密钥'],
    ['zh-TW', '顯示', '隱藏', '顯示 API 金鑰', '隱藏 API 金鑰'],
  ])('visibility_action_is_localized (%s)', async (language, show, hide, showLabel, hideLabel) => {
    await i18n.changeLanguage(language)
    renderDialog('openai')
    const button = screen.getByRole('button', { name: showLabel })
    expect(button).toHaveTextContent(show)
    expect(button).not.toHaveAttribute('aria-pressed')
    fireEvent.click(button)
    expect(screen.getByRole('button', { name: hideLabel })).toHaveTextContent(hide)
    expect(button).not.toHaveAttribute('aria-pressed')
  })

  it('language_change_updates_the_visible_and_accessible_action', async () => {
    renderDialog('openai')
    fireEvent.click(screen.getByText('Show', { selector: 'button' }))
    await act(() => i18n.changeLanguage('zh-CN'))
    expect(screen.getByRole('button', { name: '隐藏 API 密钥' })).toHaveTextContent('隐藏')
    expect(apiKeyInput()).toHaveAttribute('type', 'text')
    expect(mutations.create.mutate).not.toHaveBeenCalled()
    expect(mutations.update.mutate).not.toHaveBeenCalled()
  })
})
