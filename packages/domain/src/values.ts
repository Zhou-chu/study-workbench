/** Conservative absolute HTTP(S) shape, never an account identity or dispatch authority. */
export function safeHttpTarget(value: string): boolean {
  return /^https?:\/\/(?:\[[0-9a-fA-F:]+\]|[^\s/?#@:\\]+)(?::[0-9]{1,5})?(?:\/[^\s?#\\]*)?$/.test(value)
}
export function utf8Bytes(value: string): number {
  let bytes = 0
  for (const character of value) { const point = character.codePointAt(0)!; bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4 }
  return bytes
}
export function freezeValue<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeValue(child); Object.freeze(value) }
  return value
}
