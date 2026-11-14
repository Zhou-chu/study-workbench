/** Metadata only, for this loaded application session. Not durable idempotency.
 * Reloads, other tabs and other devices do not share this protection.
 * Resource IDs identify inputs, never an acknowledged queue command.
 */
export interface CommandSubmissionMetadata {
  resource_id?: string
  resource_type?: string
  command_id?: string
}

class SubmissionStillUncertain extends Error {
  constructor(readonly metadata: CommandSubmissionMetadata) {
    super('COMMAND_SUBMISSION_UNKNOWN')
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

export function parseCommandSubmissionUnknown(error: unknown): CommandSubmissionMetadata | null {
  if (error instanceof SubmissionStillUncertain) return error.metadata
  const response = record(record(error)?.response)
  const detail = record(record(response?.data)?.detail)
  if (response?.status !== 409 || detail?.code !== 'COMMAND_SUBMISSION_UNKNOWN' || detail.retry_safe !== false) return null
  const metadata: CommandSubmissionMetadata = {}
  for (const key of ['resource_id', 'resource_type', 'command_id'] as const) {
    if (typeof detail[key] === 'string' && detail[key].length > 0) metadata[key] = detail[key]
  }
  return metadata
}

export function isCommandSubmissionUnknown(error: unknown): boolean {
  return parseCommandSubmissionUnknown(error) !== null
}

const uncertain = new Map<string, CommandSubmissionMetadata>()
const inFlight = new Set<string>()

export function hasUncertainCommandSubmission(key: string): boolean {
  return uncertain.has(key)
}

export async function runCommandSubmission<T>(key: string, submit: () => Promise<T>, confirmMessage: string): Promise<T> {
  const previous = uncertain.get(key)
  if (inFlight.has(key)) throw new SubmissionStillUncertain(previous ?? {})
  // A new intentional attempt is not reconciliation of the previous attempt.
  // Neither empty lists nor an old resource command status can clear this latch.
  if (previous && (typeof window === 'undefined' || !window.confirm(confirmMessage))) {
    throw new SubmissionStillUncertain(previous)
  }
  inFlight.add(key)
  try {
    return await submit()
  } catch (error) {
    const metadata = parseCommandSubmissionUnknown(error)
    if (metadata) {
      uncertain.set(key, metadata)
      // A retained source can appear in the list before its queue acceptance is
      // known. Its retry button is another entry to the same processing action.
      // This is only a risk gate; the resource ID is never used for job polling.
      if (key === 'source:create' && metadata.resource_type === 'source' && metadata.resource_id) {
        uncertain.set('source:retry:' + metadata.resource_id, metadata)
      }
    }
    throw error
  } finally {
    inFlight.delete(key)
  }
}
