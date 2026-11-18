import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import schema from '../../../../contracts/v1/openapi.json'
import { sessionProxyRouteExamples as examples } from '../../test/fixtures/session-proxy-route-examples'
import { matchApiRoute } from './session-proxy-policy'

describe('matchApiRoute', () => {
  it.each(examples)('documents reviewed $method $template as $kind in the API contract', ({ method, template }) => {
    if (template !== '/api/auth/web-signout-local') {
      expect(schema.paths[template as keyof typeof schema.paths]).toHaveProperty(method.toLowerCase())
    }
  })

  it('covers every static current apiClient operation without widening unsupported model GET', () => {
    const directory = path.join(process.cwd(), 'src/lib/api')
    const calls: Array<[string, string]> = []
    function example(node: ts.Expression): string[] {
      if (ts.isStringLiteralLike(node)) return [node.text]
      if (ts.isConditionalExpression(node)) return [...example(node.whenTrue), ...example(node.whenFalse)]
      if (ts.isTemplateExpression(node)) {
        return node.templateSpans.reduce((values, span) => values.flatMap(value =>
          example(span.expression).map(part => value + part + span.literal.text)), [node.head.text])
      }
      return ['record:%E8%B5%84%E6%96%99']
    }
    for (const filename of readdirSync(directory).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
      const source = ts.createSourceFile(filename, readFileSync(path.join(directory, filename), 'utf8'), ts.ScriptTarget.Latest, true)
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.expression.getText(source) === 'apiClient'
          && /^(get|post|put|patch|delete|head|options)$/.test(node.expression.name.text)) {
          const argument = node.arguments[0]
          // Returned download URLs are covered by the exact download fixtures above.
          if (argument && (ts.isStringLiteralLike(argument) || ts.isTemplateExpression(argument))) {
            for (const url of example(argument)) calls.push([node.expression.name.text.toUpperCase(), `/api${url}`])
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect(calls.length).toBeGreaterThan(100)
    for (const [method, url] of calls) {
      if (method === 'GET' && url === '/api/models/record:%E8%B5%84%E6%96%99') {
        expect(matchApiRoute(method, url)).toBeNull() // No corresponding backend operation.
      } else {
        expect(matchApiRoute(method, url), `${method} ${url}`).not.toBeNull()
      }
    }
  })
})
