import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { WizardContainer } from './wizard-container'

const steps = [
  { number: 1, title: 'Choose source', description: 'Select a file' },
  { number: 2, title: 'Review', description: 'Check settings' },
  { number: 3, title: 'Finish', description: 'Save' },
]

it('uses focusable native step buttons without submitting an enclosing form', async () => {
  const select = vi.fn()
  const submit = vi.fn(event => event.preventDefault())
  render(<form onSubmit={submit}><WizardContainer currentStep={2} steps={steps} onStepClick={select}>body</WizardContainer></form>)
  const first = screen.getByRole('button', { name: /Choose source/ })
  first.focus()
  expect(first).toHaveFocus()
  fireEvent.click(first)
  expect(select).toHaveBeenLastCalledWith(1)
  expect(first).toHaveAttribute('type', 'button')
  fireEvent.click(first)
  expect(select).toHaveBeenCalledTimes(2)
  screen.getByRole('button', { name: /Review/ }).focus()
  expect(screen.getByRole('button', { name: /Review/ })).toHaveFocus()
  expect(screen.getByRole('button', { name: /Finish/ })).toBeDisabled()
  expect(submit).not.toHaveBeenCalled()
})


it('keeps future steps unavailable and marks the current step without nested controls', () => {
  const select = vi.fn()
  render(<WizardContainer currentStep={1} steps={steps} onStepClick={select}>body</WizardContainer>)
  const current = screen.getByRole('button', { name: /Choose source/ })
  expect(current).toHaveAttribute('aria-current', 'step')
  const future = screen.getByRole('button', { name: /Review/ })
  fireEvent.click(future)
  expect(select).not.toHaveBeenCalled()
  expect(future).toBeDisabled()
  expect(current.querySelector('button, input, a')).toBeNull()
})

it('does not make read-only steps actionable when no callback is supplied', () => {
  render(<WizardContainer currentStep={2} steps={steps}>body</WizardContainer>)
  for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
})
