import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TileService, etagFor } from '../src/tile-service.js';

test('a rendered tile is cached and duplicate misses are coalesced', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'pebble-tile-test-'));
  let fetchCount = 0;
  let renderCount = 0;
  const service = new TileService({
    cacheDir,
    fetch: async () => {
      fetchCount += 1;
      return new Response(new Uint8Array([1, 2, 3]));
    },
    render: async () => {
      renderCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Buffer.from('png-result');
    }
  });
  const coords = { z: 8, x: 134, y: 91 };
  const [first, duplicate] = await Promise.all([service.getTile(coords), service.getTile(coords)]);
  const cached = await service.getTile(coords);

  assert.equal(fetchCount, 1);
  assert.equal(renderCount, 1);
  assert.equal(first.cache, 'MISS');
  assert.equal(duplicate.cache, 'MISS');
  assert.equal(cached.cache, 'HIT');
  assert.equal((await readFile(service.cachePath(coords))).toString(), 'png-result');
  assert.deepEqual(Array.from(await readFile(service.vectorCachePath(coords))), [1, 2, 3]);
  assert.equal(etagFor(cached.png), etagFor(Buffer.from('png-result')));
});


test('wide and standard variants use separate cache entries', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'pebble-tile-variant-test-'));
  const variants = [];
  const service = new TileService({
    cacheDir,
    fetch: async () => new Response(new Uint8Array([1, 2, 3])),
    render: async (buffer, zoom, variant) => {
      variants.push(variant);
      return Buffer.from(variant);
    }
  });
  const coords = { z: 8, x: 127, y: 81 };
  const standard = await service.getTile(coords, 'standard');
  const wide = await service.getTile(coords, 'wide');

  assert.equal(standard.png.toString(), 'standard');
  assert.equal(wide.png.toString(), 'wide');
  assert.notEqual(service.cachePath(coords, 'standard'), service.cachePath(coords, 'wide'));
  assert.deepEqual(variants, ['standard', 'wide']);
});
