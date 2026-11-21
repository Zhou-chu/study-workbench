import { expect, it } from 'vitest'

it('keeps the independent package free of framework/browser and legacy source imports', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const directory = new URL('../src/', import.meta.url)
  for (const name of readdirSync(directory).filter(name => name.endsWith('.ts'))) {
    const source = readFileSync(new URL(name, directory), 'utf8')
    expect(source).not.toMatch(/(?:from|import)\s*['"](?:next|react|server-only|@\/|.*frontend)/)
  }
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(Object.keys(pkg.dependencies)).toEqual(['@study/contracts'])
})
