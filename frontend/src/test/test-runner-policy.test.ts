import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
const config = readFileSync(path.resolve(process.cwd(), 'vitest.config.ts'), 'utf8')
import packageJson from '../../package.json'

describe('frontend test runner ownership', () => {
  it('excludes only the explicit Node suite beyond Vitest defaults', () => {
    const exclusion = config.match(/exclude:\s*\[([^\]]+)\]/)?.[1]
    expect(exclusion?.replace(/\s/g, '')).toBe("...configDefaults.exclude,'scripts/artifact-identity.test.mjs'")
  })

  it('runs artifact tests then forwards focused arguments to Vitest', () => {
    expect(packageJson.scripts.test).toBe('npm run test:artifact && npm run test:unit --')
    expect(packageJson.scripts['test:unit']).toBe('vitest run')
    expect(packageJson.scripts['test:artifact']).toBe('node --test scripts/artifact-identity.test.mjs')
  })

  it('keeps V8 coverage on Vitest while still running artifact checks', () => {
    expect(packageJson.scripts['test:coverage']).toBe('npm run test:artifact && vitest run --coverage')
    expect(config).toMatch(/provider:\s*'v8'/)
  })
})
