import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EpisodeProfilesPanel } from './EpisodeProfilesPanel'
import { ProfileActions } from './ProfileActions'
import { SpeakerProfilesPanel } from './SpeakerProfilesPanel'

const mutations = vi.hoisted(() => ({
  duplicateEpisode: vi.fn(),
  deleteEpisode: vi.fn(),
  duplicateSpeaker: vi.fn(),
  deleteSpeaker: vi.fn(),
}))

vi.mock('@/lib/hooks/use-podcasts', () => ({
  useDuplicateEpisodeProfile: () => ({ mutate: mutations.duplicateEpisode, isPending: false }),
  useDeleteEpisodeProfile: () => ({ mutate: mutations.deleteEpisode, isPending: false }),
  useDuplicateSpeakerProfile: () => ({ mutate: mutations.duplicateSpeaker, isPending: false }),
  useDeleteSpeakerProfile: () => ({ mutate: mutations.deleteSpeaker, isPending: false }),
}))
vi.mock('@/lib/hooks/use-models', () => ({ useModels: () => ({ data: [] }) }))

function FixtureForm({ open, initialData, onOpenChange }: {
  open: boolean
  initialData?: { name: string }
  onOpenChange: (open: boolean) => void
}) {
  return open ? <button onClick={() => onOpenChange(false)}>Close {initialData?.name}</button> : null
}

vi.mock('./forms/EpisodeProfileFormDialog', () => ({ EpisodeProfileFormDialog: FixtureForm }))
vi.mock('./forms/SpeakerProfileFormDialog', () => ({ SpeakerProfileFormDialog: FixtureForm }))

function openMenu(container: HTMLElement) {
  const trigger = container.querySelector<HTMLElement>('[data-slot="dropdown-menu-trigger"]')
  expect(trigger).not.toBeNull()
  fireEvent.keyDown(trigger!, { key: 'Enter' })
  return screen.getByRole('menu')
}

function fixture(kind: 'episode' | 'speaker') {
  return {
    kind,
    name: 'Test profile',
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    duplicatePending: false,
    deletePending: false,
  }
}

describe.each(['episode', 'speaker'] as const)('%s profile actions', (kind) => {
  it('runs edit and duplicate and confirms deletion only after explicit confirmation', () => {
    const props = fixture(kind)
    const { container } = render(<ProfileActions {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'podcasts.edit' }))
    expect(props.onEdit).toHaveBeenCalledOnce()
    fireEvent.click(within(openMenu(container)).getByRole('menuitem', { name: 'podcasts.duplicate' }))
    expect(props.onDuplicate).toHaveBeenCalledOnce()

    fireEvent.click(within(openMenu(container)).getByRole('menuitem', { name: 'podcasts.delete' }))
    const alert = screen.getByRole('alertdialog')
    const title = kind === 'episode' ? 'podcasts.deleteProfileTitle' : 'podcasts.deleteSpeakerProfileTitle'
    expect(alert).toHaveAccessibleName(title)
    expect(props.onDelete).not.toHaveBeenCalled()
    fireEvent.click(within(alert).getByRole('button', { name: 'common.cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(props.onDelete).not.toHaveBeenCalled()

    fireEvent.click(within(openMenu(container)).getByRole('menuitem', { name: 'podcasts.delete' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'podcasts.delete' }))
    expect(props.onDelete).toHaveBeenCalledOnce()
  })

  it('disables duplicate and confirmation independently while mutations are pending', async () => {
    const props = fixture(kind)
    const { container } = render(<ProfileActions {...props} duplicatePending deletePending />)
    const menuElement = openMenu(container)
    const menu = within(menuElement)
    const duplicate = menu.getByRole('menuitem', { name: 'podcasts.duplicate' })
    expect(duplicate).toHaveAttribute('aria-disabled', 'true')
    const enabledDelete = menu.getByRole('menuitem', { name: 'podcasts.delete' })
    fireEvent.keyDown(menuElement, { key: 'Home' })
    await waitFor(() => expect(enabledDelete).toHaveFocus())
    expect(props.onDuplicate).not.toHaveBeenCalled()

    fireEvent.keyDown(enabledDelete, { key: 'Enter' })
    const confirm = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'podcasts.deleting' })
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(props.onDelete).not.toHaveBeenCalled()
  })
})

it('blocks deletion of an in-use speaker profile, even if it becomes in use while confirmation is open', async () => {
  const props = fixture('speaker')
  const { container, rerender } = render(<ProfileActions {...props} />)
  fireEvent.click(within(openMenu(container)).getByRole('menuitem', { name: 'podcasts.delete' }))

  rerender(<ProfileActions {...props} deleteDisabled />)
  const alert = within(screen.getByRole('alertdialog'))
  expect(alert.getByText('podcasts.deleteSpeakerDisabledHint')).toBeVisible()
  const confirm = alert.getByRole('button', { name: 'podcasts.delete' })
  expect(confirm).toBeDisabled()
  fireEvent.click(confirm)
  expect(props.onDelete).not.toHaveBeenCalled()
  fireEvent.click(alert.getByRole('button', { name: 'common.cancel' }))

  const menu = openMenu(container)
  const item = within(menu).getByRole('menuitem', { name: 'podcasts.delete' })
  expect(item).toHaveAttribute('aria-disabled', 'true')
  fireEvent.keyDown(menu, { key: 'End' })
  await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'podcasts.duplicate' })).toHaveFocus())
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(props.onDelete).not.toHaveBeenCalled()
})


it.each(['episode', 'speaker'] as const)('wires %s template actions to their own profile and mutations', (kind) => {
  const speaker = { id: 'speaker:one', name: 'Speaker one', description: '', speakers: [] }
  const episode = {
    id: 'episode:one',
    name: 'Episode one',
    description: '',
    speaker_config: speaker.id,
    default_briefing: '',
    num_segments: 2,
  }
  const selected = kind === 'episode' ? episode : speaker
  const { container } = render(kind === 'episode'
    ? <EpisodeProfilesPanel episodeProfiles={[episode]} speakerProfiles={[speaker]} />
    : <SpeakerProfilesPanel speakerProfiles={[speaker]} usage={{}} />)

  fireEvent.click(screen.getByRole('button', { name: 'podcasts.edit' }))
  const close = screen.getByRole('button', { name: `Close ${selected.name}` })
  fireEvent.click(close)
  expect(close).not.toBeInTheDocument()

  fireEvent.click(within(openMenu(container)).getByRole('menuitem', { name: 'podcasts.duplicate' }))
  const duplicate = kind === 'episode' ? mutations.duplicateEpisode : mutations.duplicateSpeaker
  expect(duplicate).toHaveBeenCalledExactlyOnceWith(selected.id)

  fireEvent.click(within(openMenu(container)).getByRole('menuitem', { name: 'podcasts.delete' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'podcasts.delete' }))
  const remove = kind === 'episode' ? mutations.deleteEpisode : mutations.deleteSpeaker
  expect(remove).toHaveBeenCalledExactlyOnceWith({ profileId: selected.id, name: selected.name })
})
