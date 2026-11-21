/** An explicit comparator with Array.sort's default UTF-16 code-unit ordering. */
export function compareUtf16(left: string | null, right: string | null): number {
  const leftText = `${left}`
  const rightText = `${right}`
  if (leftText === rightText) return 0
  return leftText < rightText ? -1 : 1
}
