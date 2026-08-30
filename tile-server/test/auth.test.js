import assert from 'node:assert/strict';
import test from 'node:test';
import { tokenMatches } from '../src/auth.js';

test('authentication is optional when no server token is configured', () => {
  assert.equal(tokenMatches(null, undefined), true);
});

test('configured token must match exactly', () => {
  assert.equal(tokenMatches('correct-token', 'correct-token'), true);
  assert.equal(tokenMatches('correct-token', 'wrong-token'), false);
  assert.equal(tokenMatches('correct-token', undefined), false);
});
