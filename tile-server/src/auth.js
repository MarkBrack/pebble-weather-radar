import { timingSafeEqual } from 'node:crypto';

export function tokenMatches(expectedToken, suppliedToken) {
  if (!expectedToken) return true;
  if (typeof suppliedToken !== 'string') return false;

  const expected = Buffer.from(expectedToken);
  const supplied = Buffer.from(suppliedToken);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
