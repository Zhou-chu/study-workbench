import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import type { ComponentProps, PropsWithChildren } from 'react'
import type { Credential } from '@/lib/api/credentials'
import { resources } from '@/lib/locales'
import { enUS } from '@/lib/locales/en-US'
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

function makeCredential(id: string): Credential {
  return {
    id,
    name: `Synthetic configuration ${id}`,
    provider: 'openai',
    modalities: ['language'],
    base_url: 'https://synthetic.invalid/v1',
    has_api_key: true,
    created: '2026-11-02T00:00:00Z',
    updated: '2026-11-02T00:00:00Z',
    model_count: 0,
  }
}

describe('CredentialFormDialog', () => {
  it('shows the version-path hint for OpenAI-compatible providers', () => {
    renderDialog('openai_compatible')

    expect(
      screen.getByText(enUS.apiKeys.openAICompatibleBaseUrlHint),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(enUS.apiKeys.baseUrlOverrideHint),
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText(enUS.apiKeys.baseUrl)).toHaveValue('')
    expect(enUS.apiKeys.openAICompatibleBaseUrlHint).toContain(
      'http://host.docker.internal:1234/v1',
    )
  })

  it('keeps the generic Base URL hint for other URL-based providers', () => {
    renderDialog('ollama')

    expect(screen.getByText(enUS.apiKeys.baseUrlOverrideHint)).toBeInTheDocument()
    expect(
      screen.queryByText(enUS.apiKeys.openAICompatibleBaseUrlHint),
    ).not.toBeInTheDocument()
  })

  it('visibility_button_is_focusable_and_non_submitting', () => {
    renderDialog('openai')
    const input = apiKeyInput()
    const button = screen.getByText('Show', { selector: 'button' })
    expect(input).toHaveAttribute('type', 'password')
    expect(button.tabIndex).toBe(0)
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-controls', 'api-key')
    expect(button).not.toHaveAttribute('aria-pressed')
    expect(button).toHaveClass('focus-visible:ring-[3px]', 'focus-visible:ring-ring')
    fireEvent.change(input, { target: { value: 'synthetic-typed-key' } })
    fireEvent.click(button)
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveValue('synthetic-typed-key')
    fireEvent.click(button)
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveValue('synthetic-typed-key')
    expect(mutations.create.mutate).not.toHaveBeenCalled()
    expect(mutations.update.mutate).not.toHaveBeenCalled()
  })

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

  it.each(['create', 'update'] as const)('visibility_button_is_disabled_while_submitting (%s)', (pending) => {
    mutations[pending].isPending = true
    renderDialog('openai')
    const button = screen.getByText('Show', { selector: 'button' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(apiKeyInput()).toHaveAttribute('type', 'password')
    expect(mutations.create.mutate).not.toHaveBeenCalled()
    expect(mutations.update.mutate).not.toHaveBeenCalled()
  })

  it.each([
    ['provider', { provider: 'openai' }, { provider: 'anthropic' }],
    ['create to edit', { provider: 'openai' }, { provider: 'openai', credential: makeCredential('synthetic-a') }],
    ['credential identity', { provider: 'openai', credential: makeCredential('synthetic-a') }, { provider: 'openai', credential: makeCredential('synthetic-b') }],
    ['edit to create', { provider: 'openai', credential: makeCredential('synthetic-a') }, { provider: 'openai' }],
  ] as const)('target_change_remasks_without_submission (%s)', (_name, from, to) => {
    const onOpenChange = vi.fn()
    const { rerender } = renderDialog(from.provider, { ...from, onOpenChange })
    fireEvent.click(screen.getByText('Show', { selector: 'button' }))
    expect(apiKeyInput()).toHaveAttribute('type', 'text')
    rerender(<CredentialFormDialog open {...to} onOpenChange={onOpenChange} />)
    expect(apiKeyInput()).toHaveAttribute('type', 'password')
    expect(apiKeyInput()).toHaveValue('')
    expect(mutations.create.mutate).not.toHaveBeenCalled()
    expect(mutations.update.mutate).not.toHaveBeenCalled()
  })

  it('close_reopen_and_target_change_remask', () => {
    const onOpenChange = vi.fn()
    const { rerender } = renderDialog('openai', { onOpenChange })
    fireEvent.change(apiKeyInput(), { target: { value: 'synthetic-draft-key' } })
    fireEvent.change(screen.getByLabelText(enUS.apiKeys.configName), { target: { value: 'Synthetic draft' } })
    fireEvent.change(screen.getByLabelText(enUS.apiKeys.baseUrl), { target: { value: 'https://draft.invalid/v1' } })
    fireEvent.click(screen.getByText('Show', { selector: 'button' }))
    expect(apiKeyInput()).toHaveAttribute('type', 'text')

    rerender(<CredentialFormDialog open={false} provider="openai" onOpenChange={onOpenChange} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(<CredentialFormDialog open provider="openai" onOpenChange={onOpenChange} />)
    expect(apiKeyInput()).toHaveAttribute('type', 'password')
    // Open/close remasks only: it must not broaden the existing form-reset policy.
    expect(apiKeyInput()).toHaveValue('synthetic-draft-key')
    expect(screen.getByLabelText(enUS.apiKeys.configName)).toHaveValue('Synthetic draft')
    expect(screen.getByLabelText(enUS.apiKeys.baseUrl)).toHaveValue('https://draft.invalid/v1')

    fireEvent.click(screen.getByText('Show', { selector: 'button' }))
    rerender(<CredentialFormDialog open provider="anthropic" onOpenChange={onOpenChange} />)
    expect(apiKeyInput()).toHaveAttribute('type', 'password')
    expect(apiKeyInput()).toHaveValue('')

    const first = makeCredential('synthetic-a')
    fireEvent.click(screen.getByText('Show', { selector: 'button' }))
    rerender(<CredentialFormDialog open provider="openai" credential={first} onOpenChange={onOpenChange} />)
    expect(apiKeyInput()).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByText('Show', { selector: 'button' }))
    rerender(<CredentialFormDialog open provider="openai" credential={makeCredential('synthetic-b')} onOpenChange={onOpenChange} />)
    expect(apiKeyInput()).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByText('Show', { selector: 'button' }))
    rerender(<CredentialFormDialog open provider="openai" onOpenChange={onOpenChange} />)
    expect(apiKeyInput()).toHaveAttribute('type', 'password')
    expect(mutations.create.mutate).not.toHaveBeenCalled()
    expect(mutations.update.mutate).not.toHaveBeenCalled()
  })

  it('same_target_metadata_refresh_does_not_reset_visibility', () => {
    const credential = makeCredential('synthetic-a')
    const onOpenChange = vi.fn()
    const { rerender } = renderDialog('openai', { credential, onOpenChange })
    fireEvent.click(screen.getByText('Show', { selector: 'button' }))
    rerender(<CredentialFormDialog open provider="openai" credential={{ ...credential, model_count: 1 }} onOpenChange={onOpenChange} />)
    expect(apiKeyInput()).toHaveAttribute('type', 'text')
    // Existing credential-object initialization still clears the edit key.
    expect(apiKeyInput()).toHaveValue('')
  })

  it('edit_never_prefills_existing_secret', () => {
    // Unknown extra server data must not become an editable secret either.
    const credential = { ...makeCredential('synthetic-a'), api_key: 'synthetic-stored-key' }
    renderDialog('openai', { credential })
    const input = apiKeyInput()
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(screen.getByLabelText(enUS.apiKeys.configName)).toHaveValue(credential.name)
    fireEvent.click(screen.getByText('Show', { selector: 'button' }))
    expect(input).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: enUS.common.save }))
    expect(mutations.create.mutate).not.toHaveBeenCalled()
    expect(mutations.update.mutate).toHaveBeenCalledOnce()
    expect(mutations.update.mutate.mock.calls[0][0]).toEqual({
      credentialId: 'synthetic-a',
      data: {},
    })
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
