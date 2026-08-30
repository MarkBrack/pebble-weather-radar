import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RequestMetrics } from '../src/metrics.js';

test('request metrics persist totals and daily counts across instances', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pebble-metrics-test-'));
  const filePath = path.join(directory, 'metrics.json');
  const first = new RequestMetrics({
    filePath,
    now: () => new Date('2026-08-31T10:00:00Z')
  });

  await Promise.all([
    first.record('viewportRequests'),
    first.record('viewportRequests'),
    first.record('cacheHit' + 's')
  ]);

  const reloaded = new RequestMetrics({ filePath });
  const snapshot = await reloaded.snapshot();
  assert.equal(snapshot.totals.viewportRequests, 2);
  assert.equal(snapshot.totals.cacheHits, 1);
  assert.equal(snapshot.daily['2026-08-31'].viewportRequests, 2);
});
