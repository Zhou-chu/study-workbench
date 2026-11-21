import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import MarkdownPreview from '@uiw/react-markdown-preview'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PREVIEW_OPTIONS } from './markdown-editor'

vi.mock('next/dynamic', () => ({
  default: () =>
    function MockMarkdownEditor(props: { 'data-color-mode'?: string }) {
      return <div data-testid="md-editor" data-color-mode={props['data-color-mode']} />
    },
}))

describe('MarkdownEditor preview sanitization', () => {
  it('restores top-level list markers without overriding nested and task lists', () => {
    const appCss = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    const previewCss = readFileSync(
      join(process.cwd(), 'node_modules/@uiw/react-markdown-preview/markdown.css'),
      'utf8'
    )
    const markerRules = ['ul', 'ol'].map((tag) => {
      const selector = `.w-md-editor-preview :where(.wmde-markdown ${tag})`
      const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const match = appCss.match(new RegExp(`${escapedSelector}\\s*\\{[^}]+\\}`))
      expect(match, `missing marker rule for ${tag}`).not.toBeNull()
      return match![0]
    })
    expect(previewCss).toMatch(
      /\.wmde-markdown ol ol,\s*\.wmde-markdown ul ol\s*\{[^}]*list-style-type:\s*lower-roman/
    )
    const style = document.createElement('style')
    style.textContent = `ol, ul, menu { list-style: none; }\n${previewCss}\n${markerRules.join('\n')}`
    document.head.appendChild(style)

    try {
      const { container } = render(
        <div className="w-md-editor-preview">
          <MarkdownPreview
            source={'- Bullet\n  1. Nested ordered\n\n1. Ordered\n\n- [x] Task'}
            remarkPlugins={PREVIEW_OPTIONS.remarkPlugins}
            rehypePlugins={PREVIEW_OPTIONS.rehypePlugins}
          />
        </div>
      )
      const markdown = container.querySelector('.wmde-markdown')!
      const topLevelUl = markdown.querySelector(':scope > ul:not(.contains-task-list)')!
      const topLevelOl = markdown.querySelector(':scope > ol')!
      const taskItem = markdown.querySelector('li.task-list-item')!

      expect(getComputedStyle(topLevelUl).listStyleType).toBe('disc')
      expect(getComputedStyle(topLevelOl).listStyleType).toBe('decimal')
      expect(getComputedStyle(taskItem).listStyleType).toBe('none')
    } finally {
      style.remove()
    }
  })
})
