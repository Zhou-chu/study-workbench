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
