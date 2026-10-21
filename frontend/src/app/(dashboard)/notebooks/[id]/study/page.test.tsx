import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import StudyPage from './page'

vi.mock('@/components/layout/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/workbench/StudyWorkbench', () => ({ StudyWorkbench: ({ notebookId }: { notebookId: string }) => <p>{notebookId}</p> }))

describe('StudyPage route identity', () => {
  it.each(['notebook%3Aexample', 'notebook:example'])('passes the canonical notebook ID from %s', async id => {
    render(await StudyPage({ params: Promise.resolve({ id }) }))
    expect(screen.getByText('notebook:example')).toBeInTheDocument()
  })
  it('does not repeatedly decode an encoded ID', async () => {
    render(await StudyPage({ params: Promise.resolve({ id: 'notebook%3Aexample%2520name' }) }))
    expect(screen.getByText('notebook:example%20name')).toBeInTheDocument()
  })
  it('handles a malformed escape without crashing the route', async () => {
    render(await StudyPage({ params: Promise.resolve({ id: 'notebook:example%' }) }))
    expect(screen.getByText('notebook:example%')).toBeInTheDocument()
  })
})
