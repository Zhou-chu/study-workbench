import { MutationObserver } from '@tanstack/react-query'
import { afterEach, expect, it } from 'vitest'

import { queryClient } from './query-client'

afterEach(() => queryClient.clear())

it('generic mutations with no hook override make only one request', async () => {
  let calls = 0
  const observer = new MutationObserver(queryClient, { mutationFn: async () => { calls++; throw new Error('unknown save outcome') } })
  await expect(observer.mutate()).rejects.toThrow('unknown save outcome')
  expect(calls).toBe(1)
  expect(queryClient.getDefaultOptions().queries?.retry).toBe(false)
})
