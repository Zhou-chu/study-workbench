import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { learningWorkspaceEn, learningWorkspaceLocales, learningWorkspaceZh } from './learning-workspace'

it('preserves all ordered learning-workspace messages and the named locale exports', () => {
  // Updated only after reviewing an intentional translation or key-order change.
  const json = JSON.stringify(learningWorkspaceLocales)
  expect(createHash('sha256').update(json).digest('hex')).toBe(
    '12e5205048620052d2d59a87f497a5e6bb7b3afc871665f0f69348bbf323ac28',
  )
  expect(learningWorkspaceLocales['en-US']).toBe(learningWorkspaceEn)
  expect(learningWorkspaceLocales['zh-CN']).toBe(learningWorkspaceZh)
})
