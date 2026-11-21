export function streamingUploadBytes(): Buffer {
  return Buffer.from(Array.from({ length: 1_048_593 }, (_, i) => i % 256))
}
