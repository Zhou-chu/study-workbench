import { expect, it } from 'vitest'
import { streamingUploadBytes } from './fixtures/streaming-upload.js'

it('exact binary equality rejects changed bytes and lengths without reducing the upload fixture', () => {
  const original = streamingUploadBytes();
  expect(Buffer.compare(original, Buffer.from(Array.from({ length: 1_048_593 }, (_, i) => i % 256)))).toBe(0);
  expect(Buffer.from(original).equals(original)).toBe(true);
  for (const index of [0, Math.floor(original.length / 2), original.length - 1]) {
    const changed = Buffer.from(original); changed[index] = changed[index]! ^ 1;
    expect(changed.equals(original)).toBe(false);
  }
  expect(original.subarray(0, -1).equals(original)).toBe(false);
  expect(Buffer.concat([original, Buffer.from([0])]).equals(original)).toBe(false);
});
