import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { safeReturnPath } from './cold-return';

it.each([
  ['/login///', null], ['/%6cogin/%2f', null], ['/LOGIN///?next=/sources', null],
  ['/sources///?tab=all#scope', '/sources///?tab=all#scope'],
  ['/sources/%2fkeep', '/sources/%2fkeep'], ['/', '/'],
  ['/%5csecret', null], ['/%00secret', null], ['/bad%zz', null],
])('preserves safe navigation and login-loop rejection for %s', (value, expected) => {
  expect(safeReturnPath(value)).toBe(expected);
});

it('bounds slash-run processing even when the path does not end in a slash', () => {
  // A child deadline contains the old quadratic regexp rather than hanging the suite.
  // The imported function is production code; no parser or URL behavior is mocked.
  const source = pathToFileURL(resolve('src/features/auth/cold-return.ts')).href;
  const code = `const { safeReturnPath } = await import(${JSON.stringify(source)});
    const result = safeReturnPath('/sources/' + '/'.repeat(200000) + 'x');
    process.stdout.write(JSON.stringify({length: result?.length, tail: result?.slice(-1)}));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8', timeout: 3000, maxBuffer: 4096,
    env: { NODE_NO_WARNINGS: '1' },
  });
  expect(result.error, 'return-path normalization exceeded its isolated deadline').toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ length: 200010, tail: 'x' });
});
