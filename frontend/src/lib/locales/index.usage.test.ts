import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { enUS } from './en-US'

const getKeys = (obj: Record<string, unknown>, prefix = ''): string[] => {
  return Object.keys(obj).reduce((res: string[], el) => {
    const val = obj[el]
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      return [...res, ...getKeys(val as Record<string, unknown>, prefix + el + '.')]
    }
    return [...res, prefix + el]
  }, [])
}

describe('Unused Key Detection', () => {
  it(
    'all en-US leaf keys should be referenced in source files',
    () => {
      // Only authored application source may satisfy this assertion.
      const srcDir = path.resolve(__dirname, '../..')
      const localesDir = path.resolve(__dirname)

      const files = fs.readdirSync(srcDir, { recursive: true }) as string[]
      const sourceFiles = files.filter(f => {
        const full = path.join(srcDir, f)
        if (full.startsWith(localesDir)) return false
        if (f.endsWith('.test.ts') || f.endsWith('.test.tsx')) return false
        return f.endsWith('.ts') || f.endsWith('.tsx')
      })

      // Normalize optional chaining (t?.common?.key → t.common.key)
      // so that keys like "common.errorDetails" match "common?.errorDetails"
      const corpus = sourceFiles
        .map(f => fs.readFileSync(path.join(srcDir, f), 'utf-8'))
        .join('\n')
        .replace(/\?\./g, '.')

      // Plural forms (key_one, key_other, …) are resolved by i18next from the
      // base key passed to t(), so check the base key instead.
      const pluralSuffix = /_(zero|one|two|few|many|other)$/
      const leafKeys = getKeys(enUS)
      const unused = leafKeys.filter(
        key => !corpus.includes(key.replace(pluralSuffix, '')),
      )

      expect(
        unused,
        `Found ${unused.length} unused i18n key(s):\n${unused.join('\n')}`,
      ).toEqual([])
    },
    30_000,
  )
})
