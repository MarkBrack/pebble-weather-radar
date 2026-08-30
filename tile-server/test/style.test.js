import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeXml, includePlace, labelPlacement, roadRank, roadWidths } from '../src/style.js';
import { parseTileCoordinates } from '../src/tile-service.js';

test('road visibility increases with zoom', () => {
  assert.equal(roadRank('motorway', 5), 4);
  assert.equal(roadRank('trunk', 6), 3);
  assert.equal(roadRank('primary', 7), 0);
  assert.equal(roadRank('primary', 8), 2);
  assert.equal(roadRank('secondary', 8), 0);
  assert.equal(roadRank('secondary', 9), 1);
  assert.equal(roadRank('residential', 14), 0);
});

test('wide tiles compensate for the phone two-times downsample', () => {
  const standard = roadWidths(4, 8, 1);
  const wide = roadWidths(4, 8, 2);
  assert.equal(wide.casing, standard.casing * 2);
  assert.equal(wide.fill, standard.fill * 2);
});

test('labels flip towards the roomier tile edge and avoid vertical clipping', () => {
  assert.deepEqual(labelPlacement({ x: 220, y: 1 }, 'Newcastle upon Tyne', 20, 2), {
    x: 212, y: 22, anchor: 'end'
  });
  assert.deepEqual(labelPlacement({ x: 30, y: 255 }, 'Sunderland', 20, 2), {
    x: 38, y: 253, anchor: 'start'
  });
});

test('only significant populated places are labelled', () => {
  assert.equal(includePlace({ kind: 'city', name: 'Milan', population: 1370000 }, 8), true);
  assert.equal(includePlace({ kind: 'state_capital', name: 'Turin', population: 850000 }, 5), true);
  assert.equal(includePlace({ kind: 'city', name: 'Small city', population: 40000 }, 8), false);
  assert.equal(includePlace({ kind: 'town', name: 'Town', population: 30000 }, 10), true);
  assert.equal(includePlace({ kind: 'village', name: 'Village', population: 10000 }, 14), false);
});

test('labels are escaped for SVG', () => {
  assert.equal(escapeXml('A&B <City>'), 'A&amp;B &lt;City&gt;');
});

test('slippy coordinates are bounded by zoom', () => {
  assert.deepEqual(parseTileCoordinates('8', '134', '91'), { z: 8, x: 134, y: 91 });
  assert.equal(parseTileCoordinates('8', '256', '91'), null);
  assert.equal(parseTileCoordinates('15', '1', '1'), null);
  assert.equal(parseTileCoordinates('x', '1', '1'), null);
});
