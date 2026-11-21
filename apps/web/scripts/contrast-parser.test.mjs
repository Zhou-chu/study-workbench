import assert from 'node:assert/strict'
import test from 'node:test'

import { parseThemeBlocks } from './contrast-parser.mjs'

const original = css => [...css.matchAll(/:root[^}]*\{([^}]+)\}/g)].map(match => Object.fromEntries([...match[1].matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map(item => [item[1], item[2]])))

test('preserves original root greediness and token grammar', () => {
  for (const css of [
    ':root{--text:#ABC123}', ':root{}', ':root{{}', ':root{{x}',
    ':root { --a:#000001 {--b:#000002} --c:#000003}',
    ':root } :root{--a:#000001}', ':root{:root{--x:#abcdef}}',
    ':root{--a-b: \t#ABCDEF; ---:#123456; --a:#11223344; --a:#fedcba}',
    ':root{--日本:#abcdef;--a:#fff;--b: #12GG34;--c: #123456}',
    ':root{--x:\u00a0#010203} :root[data-theme="dark"]{--x:#040506}',
  ]) assert.deepEqual(parseThemeBlocks(css), original(css), css)
})

for (const [name, css] of [
  ['unterminated repeated roots', ':root '.repeat(24000)],
  ['hyphen token without colon', ':root{' + '-'.repeat(40000) + '}'],
]) test(name + ' has bounded CPU cost', () => {
  const before = process.cpuUsage()
  const result = parseThemeBlocks(css)
  const used = process.cpuUsage(before)
  assert.deepEqual(result, name.startsWith('unterminated') ? [] : [{}])
  assert.ok(used.user + used.system < 400000, `CPU microseconds: ${used.user + used.system}`)
})


test('small exhaustive delimiter arrangements retain historical root boundaries', () => {
  const atoms = [':root', '{', '}', 'x', '--a:#123456']
  function visit(text, depth) {
    assert.deepEqual(parseThemeBlocks(text), original(text), text)
    if (depth) for (const atom of atoms) visit(text + atom, depth - 1)
  }
  visit('', 5)
})

test('token malformed runs and duplicates retain historical extraction', () => {
  const atoms = ['-', '--', 'a', '_', ':', '#123456', '#abcdef00', ' ', '\n', '#gggggg']
  function visit(body, depth) {
    const css = ':root{' + body + '}'
    assert.deepEqual(parseThemeBlocks(css), original(css), css)
    if (depth) for (const atom of atoms) visit(body + atom, depth - 1)
  }
  visit('', 4)
  for (const body of ['--__proto__:#123456', '--A:#abcdef;--a:#123456;--A:#000000', '--x:\ufeff#123456']) {
    assert.deepEqual(parseThemeBlocks(':root{' + body + '}'), original(':root{' + body + '}'))
  }
})
