/** Display-only shortening. Canonical IDs still own requests, keys and citations. */
export function versionPrefix(id: string, displayedIds: readonly string[]): string {
  if (displayedIds.filter(other => other === id).length > 1) return id
  let length = Math.min(8, id.length)
  while (length < id.length && displayedIds.some(other => other !== id && other.startsWith(id.slice(0, length)))) length++
  return id.slice(0, length)
}

/** The input must already be projected by projectWorkbenchVersion. */
export function versionDateLabel(value: string | null, language: string): string | null {
  if (value === null) return null
  const dateOnly = value.length === 10
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
    ...(!dateOnly && { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }),
  }
  let formatter: Intl.DateTimeFormat
  try { formatter = new Intl.DateTimeFormat(language, options) }
  catch { formatter = new Intl.DateTimeFormat('en-US', options) }
  return formatter.format(new Date(dateOnly ? `${value}T00:00:00Z` : value))
}
