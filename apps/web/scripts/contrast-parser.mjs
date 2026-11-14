// Compatibility parser for the checker's historical lexical grammar, not a CSS parser.
const nameCharacter = /[\w-]/
const whitespace = /\s/
const sixHexDigits = /^[\da-f]{6}$/i

function parseTokens(body) {
  const entries = []
  let cursor = 0
  while (cursor < body.length) {
    if (!nameCharacter.test(body[cursor])) { cursor++; continue }
    const start = cursor
    while (cursor < body.length && nameCharacter.test(body[cursor])) cursor++
    const end = cursor
    // Any later -- within this run has the same ending colon. On failure,
    // skip the entire run instead of retrying every hyphen as a new start.
    const run = body.slice(start, end)
    const marker = run.indexOf('--')
    if (marker < 0 || marker + 2 === run.length || body[end] !== ':') continue
    cursor++
    while (cursor < body.length && whitespace.test(body[cursor])) cursor++
    if (body[cursor] !== '#') continue
    const digits = body.slice(cursor + 1, cursor + 7)
    if (!sixHexDigits.test(digits)) { cursor++; continue }
    entries.push([run.slice(marker + 2), '#' + digits])
    cursor += 7
  }
  return Object.fromEntries(entries)
}

export function parseThemeBlocks(css) {
  const blocks = []
  let cursor = 0
  while (cursor < css.length) {
    const root = css.indexOf(':root', cursor)
    if (root < 0) break
    const close = css.indexOf('}', root + 5)
    if (close < 0) break
    // The old greedy prefix selects the last { that leaves a nonempty body.
    // Slice bounds the backwards search to this }-delimited region.
    const region = css.slice(root + 5, close)
    const open = region.lastIndexOf('{', region.length - 2)
    if (open >= 0 && open + 1 < region.length) {
      blocks.push(parseTokens(region.slice(open + 1)))
    }
    cursor = close + 1
  }
  return blocks
}
