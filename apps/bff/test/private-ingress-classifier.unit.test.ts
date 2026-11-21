import { expect, it } from 'vitest'
import { classifyIngressResponse } from '../src/public-config.js'

it.each([
  [200, 'application/json', null, 'expected'], [401, 'application/json', null, 'expected'],
  [416, 'text/plain', null, 'expected'], [304, null, null, 'expected'],
  [200, 'Text/HTML; charset=utf-8', null, 'ingress_reauth'], [403, 'application/xhtml+xml', null, 'ingress_reauth'],
  [302, null, 'https://synthetic-access.example/login', 'ingress_reauth'], [307, null, '/login', 'ingress_reauth'],
  [302, null, null, 'unavailable'], [503, 'text/html', null, 'unavailable'], [0, null, null, 'unavailable'],
] as const)('classifies only observable hop %s %s %s', (status, media, location, expected) => {
  expect(classifyIngressResponse(status, media, location)).toBe(expected)
})
